const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Feedback = require('../models/Feedback');
const { protect } = require('../middleware/auth');

// @route   POST /api/feedback
// @desc    Create a new feedback
// @access  Private
router.post('/', protect, [
  body('trainNo').trim().notEmpty().withMessage('Train number is required'),
  body('trainName').trim().optional(),
  body('feedbackNo').trim().notEmpty().withMessage('Feedback number is required').isInt().withMessage('Feedback number must be an integer'),
  body('coachNo').trim().notEmpty().withMessage('Coach number is required'),
  body('pnr').matches(/^\d+$/).withMessage('PNR must contain only numbers'),
  body('mobile').matches(/^\d{10}$/).withMessage('Mobile must be a valid 10-digit number'),
  body('psi').isNumeric().withMessage('PSI is required and must be a number'),
  body('reportDate').isISO8601().withMessage('Valid report date is required')
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const {
      feedbackNo: feedbackNoFromBody,
      trainNo,
      trainName,
      coachNo,
      pnr,
      mobile,
      ns1,
      ns2,
      ns3,
      psi,
      reportDate,
      feedbackText,
      feedbackRating
    } = req.body;

    // Validation: Either feedbackText or feedbackRating must be provided
    if (!feedbackText && !feedbackRating) {
      return res.status(400).json({
        success: false,
        message: 'Either feedback text or feedback rating is required'
      });
    }

    // Use feedbackNo provided by client
    const feedbackNo = Number(feedbackNoFromBody);

    // Create feedback
    const feedback = await Feedback.create({
      feedbackNo,
      trainNo,
      trainName: trainName || '',
      coachNo,
      pnr,
      mobile,
      ns1: ns1 || 0,
      ns2: ns2 || 0,
      ns3: ns3 || 0,
      psi,
      reportDate,
      feedbackText: feedbackText || '',
      feedbackRating: feedbackRating || '',
      submittedBy: req.user._id,
      submittedByUserId: req.user.userId
    });

    res.status(201).json({
      success: true,
      data: feedback
    });
  } catch (error) {
    console.log(error);
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   GET /api/feedback/count
// @desc    Get feedback count for a train on a specific date
// @access  Private
router.get('/count', protect, async (req, res) => {
  try {
    const { trainNo, date } = req.query;

    if (!trainNo || !date) {
      return res.status(400).json({
        success: false,
        message: 'Train number and date are required'
      });
    }

    const feedbackDate = new Date(date);
    const startOfDay = new Date(feedbackDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(feedbackDate.setHours(23, 59, 59, 999));

    const count = await Feedback.countDocuments({
      trainNo,
      reportDate: { $gte: startOfDay, $lte: endOfDay }
    });

    res.json({
      success: true,
      count
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/feedback/search
// @desc    Search feedbacks by train number and date
// @access  Private
router.get('/search', protect, async (req, res) => {
  try {
    const { trainNo, date } = req.query;

    if (!trainNo || !date) {
      return res.status(400).json({
        success: false,
        message: 'Train number and date are required'
      });
    }

    const feedbackDate = new Date(date);
    const startOfDay = new Date(feedbackDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(feedbackDate.setHours(23, 59, 59, 999));

    const feedbacks = await Feedback.find({
      trainNo,
      reportDate: { $gte: startOfDay, $lte: endOfDay }
    }).sort({ feedbackNo: 1 });

    res.json({
      success: true,
      count: feedbacks.length,
      data: feedbacks
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/feedback/:id
// @desc    Get feedback by ID
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const feedback = await Feedback.findById(req.params.id);

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    res.json({
      success: true,
      data: feedback
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   GET /api/feedback
// @desc    Get all feedbacks with pagination
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const total = await Feedback.countDocuments();
    const feedbacks = await Feedback.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip);

    res.json({
      success: true,
      count: feedbacks.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      data: feedbacks
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @route   PUT /api/feedback/:id
// @desc    Update feedback by ID
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    const { feedbackNo, trainNo, trainName, coachNo, pnr, mobile, ns1, ns2, ns3, psi, reportDate, feedbackText, feedbackRating, totalFeedbacks, totalPercentageAtPSI, averagePSIRoundTrip } = req.body;

    let feedback = await Feedback.findById(req.params.id);
    if (!feedback) {
      return res.status(404).json({ success: false, message: 'Feedback not found' });
    }

    if (feedbackNo !== undefined) feedback.feedbackNo = feedbackNo;
    if (trainNo !== undefined) feedback.trainNo = trainNo;
    if (trainName !== undefined) feedback.trainName = trainName;
    if (coachNo !== undefined) feedback.coachNo = coachNo;
    if (pnr !== undefined) feedback.pnr = pnr;
    if (mobile !== undefined) feedback.mobile = mobile;
    if (ns1 !== undefined) feedback.ns1 = ns1;
    if (ns2 !== undefined) feedback.ns2 = ns2;
    if (ns3 !== undefined) feedback.ns3 = ns3;
    if (psi !== undefined) feedback.psi = psi;
    if (reportDate !== undefined) feedback.reportDate = reportDate;
    if (feedbackText !== undefined) feedback.feedbackText = feedbackText;
    if (feedbackRating !== undefined) feedback.feedbackRating = feedbackRating;
    if (totalFeedbacks !== undefined) feedback.totalFeedbacks = totalFeedbacks;
    if (totalPercentageAtPSI !== undefined) feedback.totalPercentageAtPSI = totalPercentageAtPSI;
    if (averagePSIRoundTrip !== undefined) feedback.averagePSIRoundTrip = averagePSIRoundTrip;

    feedback = await feedback.save();

    res.json({
      success: true,
      message: 'Feedback updated successfully',
      data: feedback
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// @route   DELETE /api/feedback/:id
// @desc    Delete feedback by ID
// @access  Private
router.delete('/:id', protect, async (req, res) => {
  try {
    const feedback = await Feedback.findByIdAndDelete(req.params.id);

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: 'Feedback not found'
      });
    }

    res.json({
      success: true,
      message: 'Feedback deleted successfully'
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;




