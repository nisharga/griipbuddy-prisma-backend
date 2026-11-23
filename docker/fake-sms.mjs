// A fake BulkSMSBD gateway for local testing: nothing is really sent.
// It accepts the same request as http://bulksmsbd.net/api/smsapi, prints the
// message, and answers { response_code: 202 } like the real one.
//
//   GET /api/smsapi?api_key=..&senderid=..&number=..&message=..   → "send" an SMS
//   GET /messages                                                  → the last 50 messages
import http from "node:http";

const messages = [];

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    res.setHeader("content-type", "application/json");

    if (url.pathname === "/api/smsapi") {
      const sms = {
        to: url.searchParams.get("number"),
        sender_id: url.searchParams.get("senderid"),
        message: url.searchParams.get("message"),
        at: new Date().toISOString(),
      };
      messages.unshift(sms);
      messages.length = Math.min(messages.length, 50);
      console.log(`📱 SMS to ${sms.to}: ${sms.message}`);
      return res.end(
        JSON.stringify({ response_code: 202, success_message: "SMS Submitted Successfully (fake)" })
      );
    }

    if (url.pathname === "/messages") return res.end(JSON.stringify(messages, null, 2));

    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Use /api/smsapi or /messages" }));
  })
  .listen(4010, () => console.log("Fake SMS gateway on http://localhost:4010"));
