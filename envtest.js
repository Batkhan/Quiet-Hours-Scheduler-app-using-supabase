import dotenv from "dotenv";
dotenv.config({ path: ".env.local" }); // explicitly load .env.local

console.log("MONGO_URI =", process.env.MONGO_URI);
