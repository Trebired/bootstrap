export default function startServer(config, app, http, serverState, log) {
  const server = http.createServer((req, res) => {
    const route = app.routes.find((item) => item.method === "GET" && item.route === req.url);
    if (route) {
      route.handler(req, res);
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  server.listen(config.port, () => {
    log.info("example.server", "listening", { port: config.port });
  });

  serverState.server = server;
}
