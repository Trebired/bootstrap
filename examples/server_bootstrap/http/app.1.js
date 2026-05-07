export default function createApp(app, log) {
  app.use((req, _res, next) => {
    log.info("example.http", "request received", {
      method: req?.method,
      url: req?.url,
    });

    if (typeof next === "function") next();
  });
}
