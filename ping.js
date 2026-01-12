// frontend/api/ping.js
module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    message: "ESboard API is alive",
    time: Date.now(),
  });
};
