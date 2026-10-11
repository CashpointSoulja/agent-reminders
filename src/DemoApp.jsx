import React, { useEffect } from "react";
import App from "../App";
import "./demo.css";

export default function DemoApp() {
  useEffect(() => { document.title = "Agent Reminders · Browser Demo"; }, []);
  return <><App /><p className="demo-note">Demo. Changes stay in this browser. Agent connections and cloud photos require a self-hosted backend.</p></>;
}
