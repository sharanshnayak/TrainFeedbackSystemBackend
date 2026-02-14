
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// Helper function to read JSON file
const readJSONFile = (filename) => {
  const filePath = path.join(__dirname, '..', 'data', filename);
  const data = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(data);
};

// @route   GET /api/data/trains
// @desc    Get all trains
// @access  Public
router.get('/trains', (req, res) => {
  try {
    const trains = readJSONFile('trains.json');
    res.json({
      success: true,
      data: trains
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error reading trains data'
    });
  }
});

// @route   GET /api/data/stations
// @desc    Get all stations
// @access  Public
router.get('/stations', (req, res) => {
  try {
    const stations = readJSONFile('stations.json');
    res.json({
      success: true,
      data: stations
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error reading stations data'
    });
  }
});

// @route   GET /api/data/coaches
// @desc    Get all coach numbers
// @access  Public
router.get('/coaches', (req, res) => {
  try {
    const coaches = readJSONFile('coaches.json');
    res.json({
      success: true,
      data: coaches
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error reading coaches data'
    });
  }
});

// @route   GET /api/data/feedback-types
// @desc    Get all feedback types
// @access  Public
router.get('/feedback-types', (req, res) => {
  try {
    const feedbackTypes = readJSONFile('feedbackTypes.json');
    res.json({
      success: true,
      data: feedbackTypes
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error reading feedback types data'
    });
  }
});

module.exports = router;

