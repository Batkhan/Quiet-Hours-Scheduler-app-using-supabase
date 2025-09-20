// testMongo.js
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function main() {
  const client = new MongoClient(process.env.MONGO_URI);

  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");

    const db = client.db("quiet_hours_db");       // DB name
    const collection = db.collection("notifications"); // collection name

    // Dummy notification
    const dummyNotification = {
      user_id: "163d27d3-6c0b-438b-a2a1-5673354edcf9",  // example Supabase user_id
      quiet_hour_id: "test-block-123",
      start_time: new Date("2025-09-20T17:40:00"),
      end_time: new Date("2025-09-20T18:00:00"),
      sent_at: new Date()
    };

    const result = await collection.insertOne(dummyNotification);
    console.log("Inserted document with _id:", result.insertedId);

    // Optional: fetch all documents to verify
    const all = await collection.find({}).toArray();
    console.log("All notifications in DB:", all);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.close();
  }
}

main();
