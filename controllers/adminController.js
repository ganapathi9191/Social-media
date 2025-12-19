// controllers/coinPackageController.js
const mongoose = require("mongoose");
const CoinPackage = require("../models/coinPackageModel");

/* ================= CREATE PACKAGE ================= */
exports.createCoinPackage = async (req, res) => {
  try {
    const { coins, price, originalPrice } = req.body;

    if (!coins || !price) {
      return res.status(400).json({
        success: false,
        message: "Coins and price are required"
      });
    }

    const pack = await CoinPackage.create({
      coins,
      price,
      originalPrice
    });

    return res.status(201).json({
      success: true,
      message: "Coin package created successfully ✅",
      data: pack
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ================= GET ALL PACKAGES ================= */
exports.getAllCoinPackages = async (req, res) => {
  try {
    const packages = await CoinPackage.find().sort({ coins: 1 });

    return res.status(200).json({
      success: true,
      total: packages.length,
      data: packages
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ================= GET PACKAGE BY ID ================= */
exports.getCoinPackageById = async (req, res) => {
  try {
    const { packageId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(packageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid packageId"
      });
    }

    const pack = await CoinPackage.findById(packageId);

    if (!pack) {
      return res.status(404).json({
        success: false,
        message: "Package not found"
      });
    }

    return res.status(200).json({
      success: true,
      data: pack
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ================= UPDATE PACKAGE ================= */
exports.updateCoinPackage = async (req, res) => {
  try {
    const { packageId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(packageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid packageId"
      });
    }

    const pack = await CoinPackage.findByIdAndUpdate(
      packageId,
      req.body,
      { new: true, runValidators: true }
    );

    if (!pack) {
      return res.status(404).json({
        success: false,
        message: "Package not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Package updated successfully ✅",
      data: pack
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ================= DELETE PACKAGE (SOFT DELETE) ================= */
exports.deleteCoinPackage = async (req, res) => {
  try {
    const { packageId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(packageId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid packageId"
      });
    }

    const pack = await CoinPackage.findByIdAndUpdate(
      packageId,
      { isActive: false },
      { new: true }
    );

    if (!pack) {
      return res.status(404).json({
        success: false,
        message: "Package not found"
      });
    }

    return res.status(200).json({
      success: true,
      message: "Package deleted (deactivated) ❌",
      data: pack
    });

  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
