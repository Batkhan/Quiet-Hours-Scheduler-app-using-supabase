import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { DateTime } from "luxon";

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

export async function GET(request) {
  // 🔒 Verify secret to prevent public triggering
  const url = new URL(request.url);
  const qSecret = url.searchParams.get("secret");
  const headerSecret = request.headers.get("x-cron-secret");
  const secret = process.env.CRON_SECRET;
  if (!secret || (qSecret !== secret && headerSecret !== secret)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  await initMongo();

  // ✅ Always work in IST
  const nowIST = DateTime.now().setZone("Asia/Kolkata");
  const bufferStartIST = nowIST.minus({ minutes: 5 }).toISO();
  const futureEndIST = nowIST.plus({ minutes: 60 }).toISO();

  console.log("=== DEBUG TIME WINDOW (IST) ===");
  console.log("Now IST:", nowIST.toISO());
  console.log("Buffer start IST:", bufferStartIST);
  console.log("Future end IST:", futureEndIST);

  const { data: blocks, error } = await supabase
    .from("quiet_hours")
    .select("id, user_id, start_time, end_time")
    .eq("notified", false)
    .gte("start_time", bufferStartIST)
    .lte("start_time", futureEndIST);

  if (error) {
    console.error("Supabase error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
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
      await supabase
        .from("quiet_hours")
        .update({ notified: true })
        .eq("id", block.id);
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
    port: Number(process.env.SMTP_PORT || 587),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const startLocal = DateTime.fromISO(startTime, { zone: "Asia/Kolkata" })
    .toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS);

  const endLocal = DateTime.fromISO(endTime, { zone: "Asia/Kolkata" })
    .toLocaleString(DateTime.DATETIME_MED_WITH_SECONDS);

  const subject = "⏰ Your quiet hour is starting soon";
  const text = `Your silent study block starts at ${startLocal} and ends at ${endLocal}.`;
  const html = `
    <div style="font-family:sans-serif;padding:12px;">
      <h2>⏰ Quiet Hour Reminder</h2>
      <p>Your silent study block starts at <strong>${startLocal}</strong> and ends at <strong>${endLocal}</strong>.</p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Quiet Hours" <batmanbeginsatdawn@gmail.com>`, // must match verified sender
    to,
    subject,
    text,
    html,
  });
}
