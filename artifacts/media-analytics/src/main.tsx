import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// When the API is on a different origin (frontend on Vercel, backend on Railway),
// set VITE_API_URL to the backend base URL. Empty/undefined → same-origin (local/Docker).
const apiUrl = import.meta.env.VITE_API_URL?.trim();
if (apiUrl) {
  setBaseUrl(apiUrl);
}

createRoot(document.getElementById("root")!).render(<App />);
