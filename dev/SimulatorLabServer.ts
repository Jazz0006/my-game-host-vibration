import express, {
  type Express,
  type Request,
  type Response,
} from "express";
import {
  SimulatorLabCoordinator,
  type SimulatorLabState,
} from "./SimulatorLabCoordinator.js";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : "Simulator operation failed";
}

function playerIdFromBody(request: Request): string {
  const value = (request.body as { playerId?: unknown } | undefined)?.playerId;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("playerId is required");
  }
  return value.trim();
}

function writeSimulatorEvent(response: Response, state: SimulatorLabState): void {
  response.write(`data: ${JSON.stringify(state)}\n\n`);
}

export function mountSimulatorLab(app: Express): SimulatorLabCoordinator {
  const coordinator = new SimulatorLabCoordinator();

  app.use("/dev/simulator/api", express.json({ limit: "32kb" }));

  app.get("/dev/simulator/api/state", (_request, response) => {
    response.json(coordinator.getState());
  });

  app.get("/dev/simulator/api/events", (request, response) => {
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    const unsubscribe = coordinator.subscribe(state => {
      writeSimulatorEvent(response, state);
    });
    request.on("close", unsubscribe);
  });

  app.post("/dev/simulator/api/reset", async (request, response) => {
    try {
      const raw = (request.body as { playerCount?: unknown } | undefined)?.playerCount;
      const playerCount = raw === undefined ? 8 : Number(raw);
      response.json(await coordinator.reset(playerCount));
    } catch (error) {
      response.status(400).json({ ok: false, message: errorMessage(error) });
    }
  });

  app.post("/dev/simulator/api/command", async (request, response) => {
    try {
      const body = request.body as {
        playerId?: unknown;
        type?: unknown;
        payload?: unknown;
      } | undefined;
      const playerId = playerIdFromBody(request);
      if (typeof body?.type !== "string" || !body.type.trim()) {
        throw new Error("Semantic command type is required");
      }
      response.json(await coordinator.sendCommand(
        playerId,
        body.type,
        body.payload ?? {},
      ));
    } catch (error) {
      response.status(400).json({ ok: false, message: errorMessage(error) });
    }
  });

  app.post("/dev/simulator/api/moderator", async (request, response) => {
    try {
      const raw = (request.body as { playerId?: unknown } | undefined)?.playerId;
      const playerId = raw === null || raw === undefined || raw === ""
        ? null
        : playerIdFromBody(request);
      response.json(await coordinator.setModerator(playerId));
    } catch (error) {
      response.status(400).json({ ok: false, message: errorMessage(error) });
    }
  });

  app.post("/dev/simulator/api/disconnect", (request, response) => {
    try {
      response.json(coordinator.disconnectPlayer(playerIdFromBody(request)));
    } catch (error) {
      response.status(400).json({ ok: false, message: errorMessage(error) });
    }
  });

  app.post("/dev/simulator/api/reconnect", async (request, response) => {
    try {
      response.json(await coordinator.reconnectPlayer(playerIdFromBody(request)));
    } catch (error) {
      response.status(400).json({ ok: false, message: errorMessage(error) });
    }
  });

  return coordinator;
}
