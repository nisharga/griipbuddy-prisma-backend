import type { RequestHandler } from "express";
import httpStatus from "http-status";

const notFound: RequestHandler = (req, res) => {
  res.status(httpStatus.NOT_FOUND).json({
    statusCode: httpStatus.NOT_FOUND,
    success: false,
    message: "API Not Found",
    errorMessages: [{ path: req.originalUrl, message: "API Not Found" }],
  });
};

export default notFound;
