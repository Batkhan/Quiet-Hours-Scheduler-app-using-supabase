import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// MongoDB setup
const mongoClient = new MongoClient(process.env.MONGO_URI);
let db;

async function initMongo() {
  if (!process.env.MONGO_URI) {
    console.error("❌ MONGO_URI not set!");
    return;
  }
  if (!db) {
    try {
      console.log("Connecting to MongoDB...");
      await mongoClient.connect();
      db = mongoClient.db("quiet_hours_db"); // must match testMongo.js
      console.log("✅ Connected to MongoDB:", db.databaseName);
    } catch (err) {
      console.error("❌ MongoDB connection error:", err);
    }
  }
}

function toISTString(date) {
  return date
    .toLocaleString("sv-SE", { timeZone: "Asia/Kolkata", hour12: false })
    .replace(" ", "T");
}

export async function GET() {
  await initMongo();

  const now = new Date();
  const bufferMinutes = 5;
  const futureMinutes = 60;

  const bufferStart = new Date(now.getTime() - bufferMinutes * 60 * 1000);
  const futureEnd = new Date(now.getTime() + futureMinutes * 60 * 1000);

  const bufferStartIST = toISTString(bufferStart);
  const futureEndIST = toISTString(futureEnd);

  console.log("=== DEBUG TIME WINDOW ===");
  console.log("Now:", now.toISOString());
  console.log("Buffer start:", bufferStartIST);
  console.log("Future end:", futureEndIST);

  const { data: blocks, error } = await supabase
    .from("quiet_hours")
    .select("id, user_id, start_time, end_time")
    .eq("notified", false)
    .gte("start_time", bufferStartIST)
    .lte("start_time", futureEndIST);

  if (error) {
    console.error("Supabase error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  console.log("Filtered blocks (eligible):", blocks);

  if (!db) {
    console.error("❌ No MongoDB connection, skipping inserts");
  }

  for (let block of blocks) {
    console.log(`Processing block ${block.id}`);

    // Check MongoDB first
    let alreadySent = null;
    try {
      alreadySent = await db?.collection("notifications").findOne({
        quiet_hour_id: block.id,
        user_id: block.user_id,
      });
    } catch (err) {
      console.error("Mongo findOne error:", err);
    }

    if (alreadySent) {
      console.log(`Notification already exists for block ${block.id}, skipping`);
      continue;
    }

    // Fetch user email
    let userData = null;
    try {
      const res = await supabase.auth.admin.getUserById(block.user_id);
      userData = res.data?.user;
      if (!userData?.email) {
        console.log("No email found for user:", block.user_id);
        continue;
      }
    } catch (err) {
      console.error("Supabase getUserById error:", err);
      continue;
    }

    console.log("Sending email to:", userData.email);
    try {
      await sendEmail(userData.email, block.start_time, block.end_time);
    } catch (err) {
      console.error("Email send error:", err);
      continue;
    }

    // Insert into MongoDB
    try {
      const result = await db?.collection("notifications").insertOne({
        user_id: block.user_id,
        quiet_hour_id: block.id,
        start_time: block.start_time,
        end_time: block.end_time,
        sent_at: new Date(),
      });
      console.log("✅ Logged notification in MongoDB:", result?.insertedId);
    } catch (err) {
      console.error("MongoDB insertOne error:", err);
    }

    // Mark as notified in Supabase
    try {
      await supabase.from("quiet_hours").update({ notified: true }).eq("id", block.id);
    } catch (err) {
      console.error("Supabase update error:", err);
    }
  }

  return new Response(
    JSON.stringify({ message: "Processing complete", count: blocks?.length || 0 }),
    { status: 200 }
  );
}

async function sendEmail(to, startTime, endTime) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: 587,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  const startLocal = new Date(startTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });
  const endLocal = new Date(endTime).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true });

  await transporter.sendMail({
    from: '"Quiet Hours" <noreply@example.com>',
    to,
    subject: "⏰ Your quiet hour is starting soon",
    text: `Your silent study block starts at ${startLocal} and ends at ${endLocal}.`,
  });
}
