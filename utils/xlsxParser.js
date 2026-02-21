const xlsx = require('xlsx');
const path = require('path');

/**
 * Parse XLSX file and extract feedback data
 * Actual XLSX structure:
 * - Row 1: Train no. as column header, Report date
 * - Row 2: Train Name label, Train name value
 * - Row 3: Column labels (Coach, Sr. No., Feedback No., PNR, Mobile, NS-1, NS-2, NS-3, PSI)
 * - Row 4+: Feedback data rows
 * - Last row: Total row (ignored)
 */
const parseXlsxFile = (filePath, debug = false) => {
  try {
    const workbook = xlsx.readFile(filePath);
    const sheetNames = workbook.SheetNames;
    
    const allFeedbacks = [];
    const sheetData = [];
    const errors = [];

    if (debug) {
      console.log('\n=== DEBUG: Sheet Analysis ===');
      console.log(`Total sheets found: ${sheetNames.length}`);
      console.log(`Sheet names: ${sheetNames.join(', ')}\n`);
    }

    // Process each sheet
    sheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const rawData = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      
      if (debug) {
        console.log(`\n📋 Sheet: "${sheetName}"`);
        console.log(`   Total rows: ${rawData.length}`);
      }
      
      if (rawData.length < 4) {
        errors.push({
          sheet: sheetName,
          error: 'Not enough rows in sheet (need at least 4 rows: train info, train name, column headers, data)'
        });
        return;
      }

      // Row 1: Extract train number and report date
      const headerRow = rawData[0];
      let trainNo = '';
      let reportDate = new Date();
      
      for (let i = 0; i < headerRow.length; i++) {
        const cell = String(headerRow[i]).trim();
        
        if (cell && /^\d+$/.test(cell) && !trainNo) {
          trainNo = cell;
        }
        
        if (cell && !reportDate && (cell.includes('/') || cell.includes('-') || !isNaN(parseFloat(cell)))) {
          const parsed = parseExcelDate(cell);
          if (parsed) {
            reportDate = parsed;
          }
        }
      }

      if (!trainNo) {
        errors.push({
          sheet: sheetName,
          error: 'Train number not found in header row'
        });
        return;
      }

      // Row 2: Extract train name
      let trainName = '';
      const trainNameRow = rawData[1];
      for (let i = 0; i < trainNameRow.length - 1; i++) {
        const cell = String(trainNameRow[i]).toLowerCase().trim();
        if (cell.includes('train name')) {
          trainName = String(trainNameRow[i + 1]).trim();
          break;
        }
      }

      // Row 3: Get column names
      const columnRow = rawData[2];
      const colIndices = findColumnIndices(columnRow);

      const sheetFeedbacks = [];

      // Process data rows (starting from row 4)
      for (let rowIdx = 3; rowIdx < rawData.length; rowIdx++) {
        const row = rawData[rowIdx];

        if (!row || row.length === 0 || row.every(cell => !cell)) {
          continue;
        }

        const firstCell = String(row[colIndices.srNo] || '').toLowerCase().trim();
        if (firstCell === 'total' || firstCell.includes('total')) {
          break;
        }

        try {
          const feedbackData = extractFeedbackRow(row, colIndices, trainNo, reportDate, debug);
          
          if (feedbackData) {
            feedbackData.trainName = trainName;
            feedbackData.sheetName = sheetName;
            const validation = validateFeedbackRow(feedbackData);
            
            if (validation.valid) {
              sheetFeedbacks.push(feedbackData);
              allFeedbacks.push(feedbackData);
            } else {
              errors.push({
                sheet: sheetName,
                row: rowIdx + 1,
                data: feedbackData,
                errors: validation.errors
              });
            }
          }
        } catch (error) {
          errors.push({
            sheet: sheetName,
            row: rowIdx + 1,
            error: error.message
          });
        }
      }

      if (sheetFeedbacks.length > 0) {
        sheetData.push({
          sheetName,
          trainNo,
          trainName,
          reportDate,
          feedbacks: sheetFeedbacks
        });
      }
    });

    return {
      success: errors.length === 0,
      feedbacks: allFeedbacks,
      sheetData: sheetData,
      errors: errors,
      totalParsed: allFeedbacks.length
    };
  } catch (error) {
    console.error('Parse error:', error);
    return {
      success: false,
      feedbacks: [],
      sheetData: [],
      errors: [{ error: error.message }],
      totalParsed: 0
    };
  }
};

/**
 * Find column indices based on header row
 */
const findColumnIndices = (headerRow) => {
  const indices = {
    srNo: -1,
    coach: -1,
    feedbackNo: -1,
    pnr: -1,
    mobile: -1,
    ns1: -1,
    ns2: -1,
    ns3: -1,
    psi: -1
  };

  for (let i = 0; i < headerRow.length; i++) {
    const header = String(headerRow[i]).toLowerCase().trim();
    
    if (header.includes('sr') || header.includes('serial')) {
      indices.srNo = i;
    } else if (header.includes('coach')) {
      indices.coach = i;
    } else if (header.includes('feedback') || header.includes('feedbac')) { // Handle typo "Feedbac No"
      indices.feedbackNo = i;
    } else if (header.includes('pnr')) {
      indices.pnr = i;
    } else if (header.includes('mobile') || header.includes('mobole') || header.includes('phone')) {
      indices.mobile = i;
    } else if ((header.includes('ns') || header.includes('ns-')) && (header.includes('1') || header === 'ns1')) {
      indices.ns1 = i;
    } else if ((header.includes('ns') || header.includes('ns-')) && (header.includes('2') || header === 'ns2')) {
      indices.ns2 = i;
    } else if ((header.includes('ns') || header.includes('ns-')) && (header.includes('3') || header === 'ns3')) {
      indices.ns3 = i;
    } else if (header === 'psi' || header.includes('psi')) {
      indices.psi = i;
    }
  }

  return indices;
};

/**
 * Extract feedback data from a row
 */
const extractFeedbackRow = (row, colIndices, trainNo, reportDate, debug = false) => {
  try {
    const getSafe = (idx) => row[idx] || '';
    
    return {
      feedbackNo: parseInt(String(getSafe(colIndices.feedbackNo)).trim()) || 0,
      trainNo: trainNo,
      coachNo: String(getSafe(colIndices.coach)).trim(),
      pnr: String(getSafe(colIndices.pnr)).trim(),
      mobile: String(getSafe(colIndices.mobile)).trim(),
      ns1: parseInt(String(getSafe(colIndices.ns1)).trim()) || 0,
      ns2: parseInt(String(getSafe(colIndices.ns2)).trim()) || 0,
      ns3: parseInt(String(getSafe(colIndices.ns3)).trim()) || 0,
      psi: parseInt(String(getSafe(colIndices.psi)).trim()) || 0,
      reportDate: reportDate
    };
  } catch (error) {
    if (debug) {
      console.log('Error extracting row:', error.message, 'Row:', row);
    }
    return null;
  }
};

/**
 * Validate individual feedback row
 */
const validateFeedbackRow = (feedbackData) => {
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
  if (!feedbackData.pnr || !/^\d+$/.test(feedbackData.pnr)) {
    errors.push('PNR must contain only numbers');
  }

  // Validate mobile
  if (!feedbackData.mobile || !/^\d{10}$/.test(feedbackData.mobile)) {
    errors.push('Mobile must be a valid 10-digit number');
  }

  // Validate PSI
  if (feedbackData.psi === null || feedbackData.psi === undefined || feedbackData.psi === '') {
    errors.push('PSI value is required');
  }

  // Validate NS values are non-negative
  if (feedbackData.ns1 < 0) errors.push('NS-1 cannot be negative');
  if (feedbackData.ns2 < 0) errors.push('NS-2 cannot be negative');
  if (feedbackData.ns3 < 0) errors.push('NS-3 cannot be negative');

  return {
    valid: errors.length === 0,
    errors: errors
  };
};

/**
 * Parse Excel date format
 */
const parseExcelDate = (dateValue) => {
  if (!dateValue) return null;

  // If it's a string, try to parse it
  if (typeof dateValue === 'string') {
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      return date;
    }
    return null;
  }

  // If it's a number (Excel serial date)
  if (typeof dateValue === 'number') {
    // Excel dates are stored as numbers starting from 1/1/1900
    const excelEpoch = new Date(1900, 0, 1);
    const date = new Date(excelEpoch.getTime() + (dateValue - 1) * 24 * 60 * 60 * 1000);
    return date;
  }

  return null;
};

/**
 * Get train name from train number (mapping from trains.json if available)
 */
const getTrainNameFromNo = async (trainNo) => {
  try {
    const trainsPath = path.join(__dirname, '../data/trains.json');
    const trains = require(trainsPath);
    
    const train = trains.find(t => String(t.train_no) === String(trainNo));
    return train ? train.train_name : 'Unknown Train';
  } catch (error) {
    return 'Unknown Train';
  }
};

module.exports = {
  parseXlsxFile,
  validateFeedbackRow,
  parseExcelDate,
  getTrainNameFromNo
};
