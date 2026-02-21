const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Feedback = require('../models/Feedback');
const { protect } = require('../middleware/auth');
const { parseXlsxFile, getTrainNameFromNo } = require('../utils/xlsxParser');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Accept only .xlsx files
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
      file.originalname.endsWith('.xlsx')) {
    cb(null, true);
  } else {
    cb(new Error('Only .xlsx files are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

/**
 * @route   POST /api/feedback/upload-xlsx
 * @desc    Upload and extract feedback data from XLSX file (no DB insertion yet)
 * @access  Private
 */
router.post('/upload-xlsx', protect, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Parse XLSX file
    const parseResult = parseXlsxFile(req.file.path);
    console.log('=== PARSER RESULT ===');
    console.log('Total parsed:', parseResult.totalParsed);
    console.log('First feedback trainName:', parseResult.feedbacks[0]?.trainName);
    console.log('SheetData:', JSON.stringify(parseResult.sheetData, null, 2));

    if (!parseResult.success && parseResult.totalParsed === 0) {
      // Clean up uploaded file
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting file:', err);
      });

      return res.status(400).json({
        success: false,
        message: 'Failed to parse XLSX file',
        errors: parseResult.errors,
        totalParsed: 0,
        feedbacks: [],
        sheetData: []
      });
    }

    // Prepare feedbacks for frontend display
    const feedbacksForDisplay = [];
    const extractionErrors = [];

    for (const feedback of parseResult.feedbacks) {
      try {
        // Use trainName from parser first, fallback to trains.json lookup
        let trainName = feedback.trainName || '';
        if (!trainName) {
          trainName = await getTrainNameFromNo(feedback.trainNo);
        }

        // Prepare feedback document for display
        const feedbackDoc = {
          feedbackNo: feedback.feedbackNo,
          trainNo: feedback.trainNo,
          trainName: trainName || '',
          coachNo: feedback.coachNo,
          pnr: feedback.pnr,
          mobile: feedback.mobile,
          ns1: feedback.ns1,
          ns2: feedback.ns2,
          ns3: feedback.ns3,
          psi: feedback.psi,
          feedbackRating: feedback.feedbackRating || 'NA',
          reportDate: feedback.reportDate,
          feedbackText: '',
          // Validation status
          valid: validateFeedbackForDisplay(feedback),
          validationErrors: getValidationErrors(feedback)
        };

        feedbacksForDisplay.push(feedbackDoc);
      } catch (error) {
        extractionErrors.push({
          feedbackNo: feedback.feedbackNo,
          trainNo: feedback.trainNo,
          coachNo: feedback.coachNo,
          error: error.message
        });
      }
    }

    // Clean up uploaded file
    fs.unlink(req.file.path, (err) => {
      if (err) console.error('Error deleting file:', err);
    });

    // Normalize parser errors to include feedbackNo for consistent frontend handling
    const normalizedParseErrors = parseResult.errors.map((err) => {
      if (err.data && err.data.feedbackNo) {
        return {
          feedbackNo: err.data.feedbackNo,
          errors: err.errors || [err.error || 'Unknown error']
        };
      }
      return {
        message: err.error || `Sheet ${err.sheet}, Row ${err.row}: Unknown error`
      };
    });

    // Compile results
    const results = {
      success: parseResult.errors.length === 0 && extractionErrors.length === 0,
      totalExtracted: feedbacksForDisplay.length,
      feedbacks: feedbacksForDisplay,
      sheetData: parseResult.sheetData || [],
      extractionErrors: normalizedParseErrors,
      validationErrors: extractionErrors,
      message: `Successfully extracted ${feedbacksForDisplay.length} feedbacks from XLSX file. Please review and submit.`
    };

    console.log('=== SENDING RESPONSE ===');
    console.log('SheetData in response:', JSON.stringify(results.sheetData, null, 2));
    console.log('First feedback trainName in response:', feedbacksForDisplay[0]?.trainName);

    res.status(200).json(results);
  } catch (error) {
    // Clean up on error
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting file:', err);
      });
    }

    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing file upload',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/feedback/submit-bulk
 * @desc    Submit extracted feedbacks to database
 * @access  Private
 */
router.post('/submit-bulk', protect, async (req, res) => {
  try {
    const { feedbacks } = req.body;

    if (!Array.isArray(feedbacks) || feedbacks.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No feedbacks provided to submit'
      });
    }

    // Validate all feedbacks
    const validFeedbacks = [];
    const invalidFeedbacks = [];

    for (const feedback of feedbacks) {
      const errors = getValidationErrors(feedback);
      if (errors.length === 0) {
        // Check if feedback with same trainNo, reportDate, and feedbackNo already exists
        let reportDateObj = feedback.reportDate;
        if (typeof feedback.reportDate === 'string') {
          const [day, month, year] = feedback.reportDate.split('/');
          reportDateObj = new Date(year, parseInt(month) - 1, day);
        }
        const startOfDay = new Date(reportDateObj.setHours(0, 0, 0, 0));
        const endOfDay = new Date(new Date(reportDateObj).setHours(23, 59, 59, 999));

        const existingFeedback = await Feedback.findOne({
          trainNo: feedback.trainNo,
          feedbackNo: feedback.feedbackNo,
          reportDate: { $gte: startOfDay, $lte: endOfDay }
        });

        if (existingFeedback) {
          invalidFeedbacks.push({
            feedbackNo: feedback.feedbackNo,
            trainNo: feedback.trainNo,
            coachNo: feedback.coachNo,
            errors: [`Feedback No. ${feedback.feedbackNo} already exists for Train No. ${feedback.trainNo} on Report Date ${feedback.reportDate}`]
          });
          continue;
        }
        // Convert dd/mm/yyyy string to Date object
        let reportDate = feedback.reportDate;
        if (typeof feedback.reportDate === 'string') {
          const [day, month, year] = feedback.reportDate.split('/');
          reportDate = new Date(year, parseInt(month) - 1, day);
        }

        validFeedbacks.push({
          feedbackNo: feedback.feedbackNo,
          trainNo: feedback.trainNo,
          trainName: feedback.trainName || '',
          coachNo: feedback.coachNo,
          pnr: feedback.pnr,
          mobile: feedback.mobile,
          ns1: feedback.ns1 || 0,
          ns2: feedback.ns2 || 0,
          ns3: feedback.ns3 || 0,
          psi: feedback.psi,
          feedbackRating: feedback.feedbackRating || 'NA',
          feedbackText: feedback.feedbackText || '',
          reportDate: reportDate,
          submittedBy: req.user._id,
          submittedByUserId: req.user.userId
        });
      } else {
        invalidFeedbacks.push({
          feedbackNo: feedback.feedbackNo,
          trainNo: feedback.trainNo,
          coachNo: feedback.coachNo,
          errors: errors
        });
      }
    }

    if (invalidFeedbacks.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some feedbacks failed validation',
        validCount: validFeedbacks.length,
        invalidCount: invalidFeedbacks.length,
        invalidFeedbacks: invalidFeedbacks
      });
    }

    // Insert valid feedbacks
    let savedFeedbacks = [];
    if (validFeedbacks.length > 0) {
      try {
        savedFeedbacks = await Feedback.insertMany(validFeedbacks);
      } catch (error) {
        if (error.code === 11000) {
          return res.status(400).json({
            success: false,
            message: 'Some feedbacks already exist in the database',
            error: error.message
          });
        }
        throw error;
      }
    }

    res.status(201).json({
      success: true,
      message: `Successfully submitted ${savedFeedbacks.length} feedbacks`,
      insertedCount: savedFeedbacks.length,
      insertedFeedbackIds: savedFeedbacks.map(f => f._id)
    });
  } catch (error) {
    console.error('Bulk submit error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting feedbacks',
      error: error.message
    });
  }
});

/**
 * Validate feedback row
 */
const getValidationErrors = (feedbackData) => {
  const errors = [];

  // Validate feedbackNo
  if (!feedbackData.feedbackNo || feedbackData.feedbackNo <= 0) {
    errors.push('Invalid feedback number');
  }

  // Validate coachNo
  if (!feedbackData.coachNo) {
    errors.push('Coach number is required');
  }

  // Validate PNR
  if (!feedbackData.pnr || !/^\d+$/.test(String(feedbackData.pnr))) {
    errors.push('PNR must contain only numbers');
  }

  // Validate mobile
  if (!feedbackData.mobile || !/^\d{10}$/.test(String(feedbackData.mobile))) {
    errors.push('Mobile must be a valid 10-digit number');
  }

  // Validate PSI
  if (feedbackData.psi === null || feedbackData.psi === undefined || feedbackData.psi === '') {
    errors.push('PSI value is required');
  }

  // Validate train number
  if (!feedbackData.trainNo) {
    errors.push('Train number is required');
  }

  // Validate report date
  if (!feedbackData.reportDate) {
    errors.push('Report date is required');
  } else if (typeof feedbackData.reportDate === 'string') {
    // Validate dd/mm/yyyy format
    const dateRegex = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!dateRegex.test(feedbackData.reportDate)) {
      errors.push('Report date must be in dd/mm/yyyy format');
    } else {
      // Validate it's a valid date
      const [day, month, year] = feedbackData.reportDate.split('/');
      const date = new Date(year, parseInt(month) - 1, day);
      if (isNaN(date.getTime())) {
        errors.push('Invalid report date');
      }
    }
  }

  // Validate NS values are non-negative
  if (feedbackData.ns1 < 0) errors.push('NS-1 cannot be negative');
  if (feedbackData.ns2 < 0) errors.push('NS-2 cannot be negative');
  if (feedbackData.ns3 < 0) errors.push('NS-3 cannot be negative');

  return errors;
};

/**
 * Check if feedback is valid
 */
const validateFeedbackForDisplay = (feedbackData) => {
  return getValidationErrors(feedbackData).length === 0;
};

module.exports = router;
