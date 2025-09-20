"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Home() {
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");       // user-provided email
  const [password, setPassword] = useState(""); // user-provided password
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [quietHours, setQuietHours] = useState([]);
  const [user, setUser] = useState(null); // track logged-in user

  // --- AUTH FUNCTIONS ---
  const signUp = async () => {
    if (!email || !password) return setMessage("Enter email and password to sign up.");
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) setMessage(`Sign Up Error: ${error.message}`);
    else setMessage("✅ Sign Up successful! Check your email for confirmation.");
  };

  const signIn = async () => {
    if (!email || !password) return setMessage("Enter email and password to sign in.");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(`Sign In Error: ${error.message}`);
      return;
    }

    setUser(data.user);
    setMessage("✅ Signed in successfully!");

    // run cleanup (remove past blocks) and then fetch current blocks for this user
    await removePastQuietHours(data.user.id);
    await fetchQuietHours(data.user.id);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setQuietHours([]);
    setMessage("Signed out.");
  };

  // --- time helpers ---
  // Convert datetime-local input (browser local) => UTC ISO to store in DB
  const toUTC = (localValue) => {
    if (!localValue) return null;
    const localDate = new Date(localValue);
    return new Date(localDate.getTime() - localDate.getTimezoneOffset() * 60000).toISOString();
  };

  // --- add quiet hour (only after sign in) ---
  const addQuietHour = async () => {
    if (!user) return setMessage("⚠️ You must be signed in to add quiet hours.");
    if (!startTime || !endTime) return setMessage("Please set both start and end times.");

    const startUTC = toUTC(startTime);
    const endUTC = toUTC(endTime);

    const { error } = await supabase
      .from("quiet_hours")
      .insert([{ user_id: user.id, start_time: startUTC, end_time: endUTC }]);

    if (error) setMessage("Error adding quiet hour: " + error.message);
    else {
      setMessage("✅ Quiet hour block added!");
      // cleanup and refresh for this user
      await removePastQuietHours(user.id);
      await fetchQuietHours(user.id);
    }
  };

  // --- fetch quiet hours for the signed-in user ---
  const fetchQuietHours = async (userId) => {
    if (!userId) return;
    const { data, error } = await supabase
      .from("quiet_hours")
      .select("id, start_time, end_time")
      .eq("user_id", userId)
      .order("start_time", { ascending: true });

    if (error) setMessage("Error fetching quiet hours: " + error.message);
    else setQuietHours(data || []);
  };

  // --- removePastQuietHours: called only after sign-in or after changes ---
  const removePastQuietHours = async (userId) => {
    if (!userId) return;

    try {
      const { data, error } = await supabase
        .from("quiet_hours")
        .select("id, end_time")
        .eq("user_id", userId);

      if (error) {
        console.error("Error fetching quiet hours for cleanup:", error.message);
        return;
      }
      if (!data || data.length === 0) return;

      const nowMs = Date.now();
      const idsToDelete = [];

      for (const row of data) {
        const raw = row.end_time;
        if (!raw) continue;

        // Robust parse attempts:
        let parsed = Date.parse(raw); // try direct
        if (isNaN(parsed)) parsed = Date.parse(raw + "Z"); // force UTC
        if (isNaN(parsed) && typeof raw === "string") parsed = Date.parse(raw.replace(" ", "T") + "Z");

        if (!isNaN(parsed) && parsed <= nowMs) {
          idsToDelete.push(row.id);
        }
      }

      if (idsToDelete.length === 0) return;

      const { error: delError } = await supabase
        .from("quiet_hours")
        .delete()
        .in("id", idsToDelete);

      if (delError) {
        console.error("Error deleting expired quiet hours:", delError.message);
      } else {
        console.log(`Removed expired quiet hours: ${idsToDelete.join(", ")}`);
      }
    } catch (err) {
      console.error("removePastQuietHours unexpected error:", err);
    }
  };

  // --- manual delete for a single block (Delete button) ---
  const deleteQuietHour = async (id) => {
    if (!user) return setMessage("⚠️ Sign in first to delete.");
    const { error } = await supabase.from("quiet_hours").delete().eq("id", id);
    if (error) setMessage("Error deleting quiet hour: " + error.message);
    else {
      setMessage("✅ Quiet hour deleted!");
      await removePastQuietHours(user.id);
      await fetchQuietHours(user.id);
    }
  };

  // --- RENDER ---
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: "40px" }}>
      <h1>Quiet Hours Scheduler</h1>

      {/* AUTH FORM */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 8, width: 220 }}
          type="email"
          autoComplete="username"
        />
        <input
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ padding: 8, width: 180 }}
          type="password"
          autoComplete="current-password"
        />
        <button onClick={signUp} style={{ padding: "8px 12px" }}>Sign Up</button>
        <button onClick={signIn} style={{ padding: "8px 12px" }}>Sign In</button>
        <button onClick={signOut} style={{ padding: "8px 12px" }}>Sign Out</button>
      </div>

      {/* only show the add/list UI after explicit sign-in */}
      {user && (
        <>
          <h2 style={{ marginTop: "20px" }}>Add Quiet Hour</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <input
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              style={{ padding: 6 }}
            />
            <input
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              style={{ padding: 6 }}
            />
            <button onClick={addQuietHour} style={{ padding: "8px 12px" }}>Add Quiet Hour</button>
            <button onClick={() => fetchQuietHours(user.id)} style={{ padding: "6px 10px" }}>Refresh</button>
          </div>

          <h2>My Quiet Hours</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {quietHours.length === 0 && <li>No quiet hours scheduled yet.</li>}
            {quietHours.map(q => (
              <li key={q.id} style={{ marginBottom: 8 }}>
                <span>
                  {new Date(q.start_time).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                  {" → "}
                  {new Date(q.end_time).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
                <button
                  onClick={() => { if (confirm("Delete this quiet hour?")) deleteQuietHour(q.id); }}
                  style={{ marginLeft: 12, padding: "4px 8px" }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p style={{ marginTop: 18, color: "blue" }}>{message}</p>
    </div>
  );
}
