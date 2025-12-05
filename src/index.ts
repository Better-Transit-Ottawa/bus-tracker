import { fetchRealtime } from "./utils/fetchRealtime.ts";

const interval = 60 * 5 * 1000;

setInterval(() => {
    fetchRealtime();
}, interval);

fetchRealtime();