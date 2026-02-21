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
      let reportDate = null;
      
      for (let i = 0; i < headerRow.length; i++) {
        const cell = String(headerRow[i]).trim();
        
        if (cell && /^\d+$/.test(cell) && !trainNo) {
          trainNo = cell;
        }
        
        // If cell contains "Report Date" or "Date", find the next non-empty cell
        if (cell && (cell.toLowerCase().includes('report date') || cell.toLowerCase().includes('date')) && !reportDate) {
          for (let j = i + 1; j < headerRow.length; j++) {
            const valueCell = headerRow[j];
            const cellStr = String(valueCell).trim();
            if (cellStr) {
              const parsed = parseExcelDate(valueCell);
              if (parsed) {
                reportDate = parsed;
              }
              break;
            }
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
      for (let i = 0; i < trainNameRow.length; i++) {
        const cell = String(trainNameRow[i]).trim();
        if (cell.toLowerCase().includes('train name')) {
          // Find the next non-empty cell
          for (let j = i + 1; j < trainNameRow.length; j++) {
            const valueCell = String(trainNameRow[j]).trim();
            if (valueCell) {
              trainName = valueCell;
              break;
            }
          }
          break;
        }
      }

      // Add error if trainName not found
      if (!trainName) {
        errors.push({
          sheet: sheetName,
          type: 'trainName',
          error: 'Train name not found in row 2'
        });
      }

      if (!reportDate) {
        errors.push({
          sheet: sheetName,
          type: 'reportDate',
          error: 'Report date not found in row 1'
        });
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
    console.log(
        'Sheet Data',sheetData
    );
    console.log('all feedbacks',allFeedbacks);
    
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
 * Calculate feedback status based on PSI value
 */
const calculateFeedbackStatus = (psi) => {
  if (psi < 85) return 'Average';
  if (psi >= 85 && psi <= 88) return 'Good';
  if (psi >= 89 && psi <= 91) return 'Very Good';
  if (psi >= 92 && psi <= 97) return 'Excellent';
  return 'Unknown'; // For PSI > 97
};

/**
 * Extract feedback data from a row
 */
const extractFeedbackRow = (row, colIndices, trainNo, reportDate, debug = false) => {
  try {
    const getSafe = (idx) => row[idx] || '';
    const psi = parseInt(String(getSafe(colIndices.psi)).trim()) || 0;
    
    return {
      feedbackNo: parseInt(String(getSafe(colIndices.feedbackNo)).trim()) || 0,
      trainNo: trainNo,
      coachNo: String(getSafe(colIndices.coach)).trim(),
      pnr: String(getSafe(colIndices.pnr)).trim(),
      mobile: String(getSafe(colIndices.mobile)).trim(),
      ns1: parseInt(String(getSafe(colIndices.ns1)).trim()) || 0,
      ns2: parseInt(String(getSafe(colIndices.ns2)).trim()) || 0,
      ns3: parseInt(String(getSafe(colIndices.ns3)).trim()) || 0,
      psi: psi,
      feedbackRating: calculateFeedbackStatus(psi),
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
 * Parse Excel date format and return as dd/mm/yyyy string
 * Handles both date serial numbers and date strings
 */
const parseExcelDate = (dateValue) => {
  if (!dateValue) return null;

  let date;

  // If it's a string, parse it
  if (typeof dateValue === 'string') {
    date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      return formatDateString(date);
    }
    return null;
  }

  // If it's a number (Excel serial date)
  if (typeof dateValue === 'number') {
    // Excel stores dates as days since 1/1/1900
    // Excel incorrectly treats 1900 as a leap year (it had a bug)
    // For dates before Mar 1, 1900 (serial < 60), calculate from Jan 1, 1900
    // For dates after Feb 28, 1900 (serial >= 60), we need to account for the bug
    
    const baseDate = new Date(1900, 0, 1); // Jan 1, 1900
    const msPerDay = 24 * 60 * 60 * 1000;
    
    // Excel day 1 = Jan 1, 1900, so dateValue - 1 gives us days to add
    // But Excel treats Feb 29, 1900 as valid (which it isn't)
    // So for dates after Feb 28, 1900 (serial 60 onwards), subtract 1
    let excelDaysToAdd = dateValue - 1;
    if (dateValue >= 60) {
      excelDaysToAdd = dateValue - 2; // Adjust for Excel's leap year bug
    }
    
    date = new Date(baseDate.getTime() + excelDaysToAdd * msPerDay);
    return formatDateString(date);
  }

  return null;
};

/**
 * Format date as dd/mm/yyyy string
 */
const formatDateString = (date) => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
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
