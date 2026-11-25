/* global console, URL, URLSearchParams */
/* eslint-disable no-console -- a dev tool whose job is printing the messages */
// A fake SMS gateway for local testing: nothing is really sent.
// It accepts the same requests as the real providers, prints the message,
// and answers like they do on success.
//
//   POST /sendsms      (Alpha SMS:  api_key, to, msg)          → { error: 0 }
//   GET  /api/smsapi   (BulkSMSBD:  api_key, number, message)  → { response_code: 202 }
//   GET  /messages     the last 50 messages
import http from "node:http";

const messages = [];

const save = (to, message) => {
  messages.unshift({ to, message, at: new Date().toISOString() });
  messages.length = Math.min(messages.length, 50);
  console.log(`📱 SMS to ${to}: ${message}`);
};

/** Query string + form/JSON body, merged into one URLSearchParams. */
const readParams = (req, url) =>
  new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const params = new URLSearchParams(url.search);
      if (body.trim().startsWith("{")) {
        for (const [key, value] of Object.entries(JSON.parse(body))) params.set(key, String(value));
      } else {
        for (const [key, value] of new URLSearchParams(body)) params.set(key, value);
      }
      resolve(params);
    });
  });

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const params = await readParams(req, url);
    res.setHeader("content-type", "application/json");

    if (url.pathname === "/sendsms") {
      save(params.get("to"), params.get("msg"));
      return res.end(
        JSON.stringify({
          error: 0,
          msg: "Request successfully submitted (fake)",
          data: { request_id: Date.now() },
        })
      );
    }

    if (url.pathname === "/api/smsapi") {
      save(params.get("number"), params.get("message"));
      return res.end(
        JSON.stringify({ response_code: 202, success_message: "SMS Submitted Successfully (fake)" })
      );
    }

    if (url.pathname === "/messages") return res.end(JSON.stringify(messages, null, 2));

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Use /sendsms, /api/smsapi or /messages" }));
  })
  .listen(4010, () => console.log("Fake SMS gateway on http://localhost:4010"));
