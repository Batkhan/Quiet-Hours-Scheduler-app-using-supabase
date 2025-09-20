import fetch from "node-fetch";

const secret = process.env.CRON_SECRET;
const url = `https://quiet-hours-scheduler-app-using-supabase-5bndgoafv.vercel.app/api/sendQuietHourEmails?secret=${secret}`;

const res = await fetch(url);
const data = await res.json();
console.log("Response:", data);
