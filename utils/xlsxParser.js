const xlsx = require('xlsx');
const path = require('path');

/**
 * Parse XLSX file and extract feedback data
 * Actual XLSX structure:
 * - Row 1: Train no. as column header, Report date
 * - Row 2: Column labels (Coach, Sr. No., Feedback No., PNR, Mobile, NS-1, NS-2, NS-3, PSI)
 * - Row 3+: Feedback data rows
 * - Last row: Total row (ignored)
 */
const parseXlsxFile = (filePath, debug = false) => {
  try {
    // Read workbook with header row 2
    const workbook = xlsx.readFile(filePath);
    const sheetNames = workbook.SheetNames;
    
    const allFeedbacks = [];
    const errors = [];

    if (debug) {
      console.log('\n=== DEBUG: Sheet Analysis ===');
      console.log(`Total sheets found: ${sheetNames.length}`);
      console.log(`Sheet names: ${sheetNames.join(', ')}\n`);
    }

    // Process each sheet
    sheetNames.forEach((sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      
      // Get raw sheet data to access headers properly
      const rawData = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      
      if (debug) {
        console.log(`\n📋 Sheet: "${sheetName}"`);
        console.log(`   Total rows: ${rawData.length}`);
        if (rawData.length > 0) {
          console.log(`   Row 1 (Train header):`, rawData[0]);
        }
        if (rawData.length > 1) {
          console.log(`   Row 2 (Column names):`, rawData[1]);
        }
        if (rawData.length > 2) {
          console.log(`   Row 3 (First data):`, rawData[2]);
        }
      }
      
      if (rawData.length < 3) {
        errors.push({
          sheet: sheetName,
          error: 'Not enough rows in sheet (need at least 3 rows)'
        });
        return;
      }

      // Row 1: Extract train number (first non-empty numeric cell) and report date
      const headerRow = rawData[0];
      let trainNo = '';
      let reportDate = new Date();
      
      // Find train number and report date from first row
      for (let i = 0; i < headerRow.length; i++) {
        const cell = String(headerRow[i]).trim();
        
        // Check if it's a number (train number)
        if (cell && /^\d+$/.test(cell) && !trainNo) {
          trainNo = cell;
        }
        
        // Check for date
        if (cell && !reportDate && (cell.includes('/') || cell.includes('-') || !isNaN(parseFloat(cell)))) {
          const parsed = parseExcelDate(cell);
          if (parsed) {
            reportDate = parsed;
          }
        }
      }

      if (debug) {
        console.log(`   Extracted Train No: "${trainNo}"`);
        console.log(`   Extracted Report Date: "${reportDate}"`);
      }

      if (!trainNo) {
        errors.push({
          sheet: sheetName,
          error: 'Train number not found in header row'
        });
        return;
      }

      // Row 2: Get column names
      const columnRow = rawData[1];
      if (debug) {
        console.log(`   Column headers: ${JSON.stringify(columnRow)}`);
      }

      // Map column indices based on header row
      const colIndices = findColumnIndices(columnRow);
      if (debug) {
        console.log(`   Column indices:`, colIndices);
      }

      // Process data rows (starting from row 3)
      for (let rowIdx = 2; rowIdx < rawData.length; rowIdx++) {
        const row = rawData[rowIdx];

        // Skip empty rows
        if (!row || row.length === 0 || row.every(cell => !cell)) {
          continue;
        }

        // Stop at Total row
        const firstCell = String(row[colIndices.srNo] || '').toLowerCase().trim();
        if (firstCell === 'total' || firstCell.includes('total')) {
          if (debug) console.log(`   Stopping at Total row (${rowIdx + 1})`);
          break;
        }

        try {
          const feedbackData = extractFeedbackRow(row, colIndices, trainNo, reportDate, debug);
          
          if (feedbackData) {
            const validation = validateFeedbackRow(feedbackData);
            
            if (validation.valid) {
              allFeedbacks.push(feedbackData);
              if (debug && rowIdx <= 4) {
                console.log(`   ✓ Row ${rowIdx + 1} valid:`, feedbackData);
              }
            } else {
              errors.push({
                sheet: sheetName,
                row: rowIdx + 1,
                data: feedbackData,
                errors: validation.errors
              });
              if (debug) {
                console.log(`   ✗ Row ${rowIdx + 1} invalid:`, validation.errors);
              }
            }
          }
        } catch (error) {
          errors.push({
            sheet: sheetName,
            row: rowIdx + 1,
            error: error.message
          });
          if (debug) {
            console.log(`   ✗ Row ${rowIdx + 1} error: ${error.message}`);
          }
        }
      }
    });

    return {
      success: errors.length === 0,
      feedbacks: allFeedbacks,
      errors: errors,
      totalParsed: allFeedbacks.length
    };
  } catch (error) {
    console.error('Parse error:', error);
    return {
      success: false,
      feedbacks: [],
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
