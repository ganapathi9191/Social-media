const express = require("express");
const router = express.Router();

const {
  createCoinPackage,
  getAllCoinPackages,
  getCoinPackageById,
  updateCoinPackage,
  deleteCoinPackage,
   upsertDownloadConfig,
  getDownloadConfigs,
  getDownloadConfigByType,
  toggleDownloadConfig
} = require("../controllers/adminController");

const {
  createCoinOrder,
  verifyCoinPayment
} = require("../controllers/coinPaymentController");


/* ===== ADMIN ===== */
router.post("/admin/package", createCoinPackage);
router.get("/admin/packages", getAllCoinPackages);
router.get("/admin/package/:packageId", getCoinPackageById);
router.put("/admin/package/:packageId", updateCoinPackage);
router.delete("/admin/package/:packageId", deleteCoinPackage);

// 🔐 Admin-only routes
router.post("/download-config", upsertDownloadConfig);
router.get("/download-config", getDownloadConfigs);
router.get("/download-config/:mediaType", getDownloadConfigByType);
router.patch("/download-config/:mediaType/toggle", toggleDownloadConfig);

router.post("/create-order", createCoinOrder);
router.post("/verify-payment", verifyCoinPayment);

module.exports = router;
