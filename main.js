const fs = require('fs');

// Function 1: Calculate shift duration
function getShiftDuration(startTime, endTime) {
  let startSec = parseTime(startTime);
  let endSec = parseTime(endTime);
  let durationSec = endSec - startSec;
  return formatDuration(durationSec);
}

// Function 2: Calculate idle time (outside 8:00 AM - 10:00 PM)
function getIdleTime(startTime, endTime) {
  let startSec = parseTime(startTime);
  let endSec = parseTime(endTime);
  const deliveryStart = 8 * 3600; 
  const deliveryEnd = 22 * 3600; 
  let idleSec = 0;
  if (startSec < deliveryStart) idleSec += deliveryStart - startSec;
  if (endSec > deliveryEnd) idleSec += endSec - deliveryEnd;
  return formatDuration(idleSec);
}

// Function 3: Calculate active time (shift - idle)
function getActiveTime(shiftDuration, idleTime) {
  let shiftSec = parseDuration(shiftDuration);
  let idleSec = parseDuration(idleTime);
  let activeSec = shiftSec - idleSec;
  return formatDuration(activeSec);
}

// Function 4: Check if met daily quota (Eid holiday reduces quota)
function metQuota(date, activeTime) {
  const normalQuotaSec = parseDuration('8:24:00');
  const eidQuotaSec = parseDuration('6:00:00');
  const isEid = (date >= '2025-04-10' && date <= '2025-04-30');
  const quotaSec = isEid ? eidQuotaSec : normalQuotaSec;
  const activeSec = parseDuration(activeTime);
  return activeSec >= quotaSec;
}

// Function 5: Add new shift record to file
function addShiftRecord(textFile, shiftObj) {
  let content = fs.readFileSync(textFile, 'utf8');
  let lines = content.split('\n').filter(line => line.trim() !== '');
  
  for (let line of lines) {
    let parts = line.split(',');
    if (parts[0] === shiftObj.driverID && parts[2] === shiftObj.date) {
      return {};
    }
  }
  
  let shiftDuration = getShiftDuration(shiftObj.startTime, shiftObj.endTime);
  let idleTime = getIdleTime(shiftObj.startTime, shiftObj.endTime);
  let activeTime = getActiveTime(shiftDuration, idleTime);
  let metQ = metQuota(shiftObj.date, activeTime);
  let hasBonus = false;
  let newRecord = {
    driverID: shiftObj.driverID,
    driverName: shiftObj.driverName,
    date: shiftObj.date,
    startTime: shiftObj.startTime,
    endTime: shiftObj.endTime,
    shiftDuration,
    idleTime,
    activeTime,
    metQuota: metQ,
    hasBonus
  };
  
  let newLine = [
    newRecord.driverID, newRecord.driverName, newRecord.date,
    newRecord.startTime, newRecord.endTime, newRecord.shiftDuration,
    newRecord.idleTime, newRecord.activeTime, newRecord.metQuota,
    newRecord.hasBonus
  ].join(',');
  
  let lastIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].split(',')[0] === shiftObj.driverID) {
      lastIndex = i;
      break;
    }
  }
  if (lastIndex === -1) {
    lines.push(newLine);
  } else {
    lines.splice(lastIndex + 1, 0, newLine);
  }
  
  fs.writeFileSync(textFile, lines.join('\n') + '\n');
  return newRecord;
}

// Function 6: Update bonus in file (no return)
function setBonus(textFile, driverID, date, newValue) {
  let content = fs.readFileSync(textFile, 'utf8');
  let lines = content.split('\n').filter(line => line.trim() !== '');
  for (let i = 0; i < lines.length; i++) {
    let parts = lines[i].split(',');
    if (parts[0] === driverID && parts[2] === date) {
      parts[9] = newValue;
      lines[i] = parts.join(',');
      break;
    }
  }
  fs.writeFileSync(textFile, lines.join('\n') + '\n');
}

// Function 7: Count bonuses for driver in month
function countBonusPerMonth(textFile, driverID, month) {
  month = month.toString().padStart(2, '0');
  let content = fs.readFileSync(textFile, 'utf8');
  let lines = content.split('\n').filter(line => line.trim() !== '');
  let count = 0;
  let foundDriver = false;
  for (let line of lines) {
    let parts = line.split(',');
    if (parts[0] === driverID) {
      foundDriver = true;
      let dateMonth = parts[2].split('-')[1];
      if (dateMonth === month && parts[9] === 'true') {
        count++;
      }
    }
  }
  return foundDriver ? count : -1;
}

// Function 8: Total active hours for driver in month
function getTotalActiveHoursPerMonth(textFile, driverID, month) {
  let content = fs.readFileSync(textFile, 'utf8');
  let lines = content.split('\n').filter(line => line.trim() !== '');
  let totalSec = 0;
  for (let line of lines) {
    let parts = line.split(',');
    if (parts[0] === driverID) {
      let dateMonth = Number(parts[2].split('-')[1]);
      if (dateMonth === month) {
        totalSec += parseDuration(parts[7]); 
      }
    }
  }
  return formatDuration(totalSec);
}

// Function 9: Required hours for driver in month (adjust for day off, Eid, bonuses)
function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
  
  let rateContent = fs.readFileSync(rateFile, 'utf8');
  let rateLines = rateContent.split('\n').filter(line => line.trim() !== '');
  let dayOff = '';
  for (let line of rateLines) {
    let parts = line.split(',');
    if (parts[0] === driverID) {
      dayOff = parts[1];
      break;
    }
  }
  
  let shiftContent = fs.readFileSync(textFile, 'utf8');
  let shiftLines = shiftContent.split('\n').filter(line => line.trim() !== '');
  let totalSec = 0;
  for (let line of shiftLines) {
    let parts = line.split(',');
    if (parts[0] === driverID) {
      let dateStr = parts[2];
      let dateMonth = Number(dateStr.split('-')[1]);
      if (dateMonth === month) {
        let weekday = new Date(dateStr).getDay();
        if (weekday !== dayMap[dayOff]) { // Only add if not day off
          let isEid = (dateStr >= '2025-04-10' && dateStr <= '2025-04-30');
          let quotaSec = isEid ? 6 * 3600 : 8 * 3600 + 24 * 60;
          totalSec += quotaSec;
        }
      }
    }
  }
  
  totalSec -= bonusCount * 2 * 3600;
  return formatDuration(totalSec);
}

// Function 10: Calculate net pay after deductions
function getNetPay(driverID, actualHours, requiredHours, rateFile) {
  
  let content = fs.readFileSync(rateFile, 'utf8');
  let lines = content.split('\n').filter(line => line.trim() !== '');
  let basePay = 0;
  let tier = 0;
  for (let line of lines) {
    let parts = line.split(',');
    if (parts[0] === driverID) {
      basePay = Number(parts[2]);
      tier = Number(parts[3]);
      break;
    }
  }
  const allowedMissing = [0, 50, 20, 10, 3][tier]; 
  let actualSec = parseDuration(actualHours);
  let reqSec = parseDuration(requiredHours);
  let missingSec = reqSec - actualSec;
  if (missingSec <= 0) return basePay;
  let missingHours = Math.floor(missingSec / 3600); 
  let billableMissing = Math.max(0, missingHours - allowedMissing);
  let deductionRate = Math.floor(basePay / 185);
  let deduction = billableMissing * deductionRate;
  return basePay - deduction;
}