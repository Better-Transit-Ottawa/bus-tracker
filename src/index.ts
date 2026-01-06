import { fetchRealtime } from "./utils/fetchRealtime.ts";
import Fastify, { type FastifyInstance } from "fastify";
import { createBusCountEndpoint } from "./endpoints/busCount.ts";
import { createBlockDetailsEndpoint } from "./endpoints/blockDetails.ts";
import cors from "@fastify/cors";
import { createListBlocksEndpoint } from "./endpoints/listBlocks.ts";
import { createListVehiclesEndpoint } from "./endpoints/listVehicles.ts";

const interval = 60 * 1000;
const server: FastifyInstance = Fastify()

setInterval(() => {
    fetchRealtime().catch((e) => console.error("Error fetching real-time data:", e));
}, interval);
fetchRealtime();

createBusCountEndpoint(server);
createBlockDetailsEndpoint(server);
createListBlocksEndpoint(server);
createListVehiclesEndpoint(server);

try {
    await server.register(cors, {
        origin: "*"
    });

    await server.listen({ port: 3000 })

} catch (err) {
    server.log.error(err)
    process.exit(1)
}
