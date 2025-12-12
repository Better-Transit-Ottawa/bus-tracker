import { fetchRealtime } from "./utils/fetchRealtime.ts";

const interval = 60 * 1000;

setInterval(() => {
    fetchRealtime().catch((e) => console.error("Error fetching real-time data:", e));
}, interval);

fetchRealtime();