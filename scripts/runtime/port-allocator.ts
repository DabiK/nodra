import { createServer } from "node:net";

export class PortAllocator {
  async free(preferred?: number): Promise<number> {
    if (preferred && await this.available(preferred)) return preferred;
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("Unable to allocate a loopback port"));
          return;
        }
        server.close((error) => error ? reject(error) : resolve(address.port));
      });
    });
  }

  async available(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
  }
}
