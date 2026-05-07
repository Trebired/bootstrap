export function attach(app, config) {
  app.get("/", (_req, res) => {
    res.end(`hello from ${config.appName}`);
  });

  app.get("/health", (_req, res) => {
    res.end("ok");
  });
}
