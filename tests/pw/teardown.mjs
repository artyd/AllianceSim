// Stop the dev stack gracefully (embedded Postgres) before Playwright kills the web server.
export default async () => {
  const port = Number(process.env.WEB_PORT || 5055);
  await fetch(`http://localhost:${port}/__shutdown`).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
};
