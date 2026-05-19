const fs = require('fs');

function parseTime(timeStr) {
  let [time, modifier] = timeStr.split(' ');
  let [hours, minutes, seconds] = time.split(':').map(Number);
  if (modifier === 'pm' && hours !== 12) hours += 12;
  if (modifier === 'am' && hours === 12) hours = 0;
  return hours * 3600 + minutes * 60 + (seconds || 0);
}

function formatDuration(seconds) {
  let hrs = Math.floor(seconds / 3600);
  let mins = Math.floor((seconds % 3600) / 60);
  let secs = seconds % 60;
  // Remove .padStart(2,'0') for hours — just return as is
  return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function parseDuration(durationStr) {
  let [h, m, s] = durationStr.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

const dayMap = { 'Saturday':0, 'Sunday':1, 'Monday':2, 'Tuesday':3, 'Wednesday':4, 'Thursday':5, 'Friday':6 };

function getShiftDuration(startTime, endTime) {
  let startSec = parseTime(startTime);
  let endSec = parseTime(endTime);
  return formatDuration(endSec - startSec);
}

function getIdleTime(startTime, endTime) {
  let startSec = parseTime(startTime);
  let endSec = parseTime(endTime);
  let idleSec = 0;
  if (startSec < 28800) idleSec += 28800 - startSec;
  if (endSec > 79200) idleSec += endSec - 79200;
  return formatDuration(idleSec);
}

function getActiveTime(shiftDuration, idleTime) {
  return formatDuration(parseDuration(shiftDuration) - parseDuration(idleTime));
}

function metQuota(date, activeTime) {
  let isEid = date >= '2025-04-10' && date <= '2025-04-30';
  let quota = isEid ? 21600 : 30240;
  return parseDuration(activeTime) >= quota;
}

function addShiftRecord(textFile, shiftObj) {
  let content = fs.readFileSync(textFile, 'utf8');
  let lines = content.split('\n').filter(l => l.trim());
  for (let line of lines) {
    let parts = line.split(',');
    if (parts[0] === shiftObj.driverID && parts[2] === shiftObj.date) return {};
  }
  let shiftDuration = getShiftDuration(shiftObj.startTime, shiftObj.endTime);
  let idleTime = getIdleTime(shiftObj.startTime, shiftObj.endTime);
  let activeTime = getActiveTime(shiftDuration, idleTime);
  let newRecord = { ...shiftObj, shiftDuration, idleTime, activeTime, metQuota: metQuota(shiftObj.date, activeTime), hasBonus: false };
  let newLine = [newRecord.driverID, newRecord.driverName, newRecord.date, newRecord.startTime, newRecord.endTime, newRecord.shiftDuration, newRecord.idleTime, newRecord.activeTime, newRecord.metQuota, newRecord.hasBonus].join(',');
  let lastIndex = -1;
  for (let i = lines.length-1; i >= 0; i--) {
    if (lines[i].split(',')[0] === shiftObj.driverID) { lastIndex = i; break; }
  }
  lastIndex === -1 ? lines.push(newLine) : lines.splice(lastIndex+1, 0, newLine);
  fs.writeFileSync(textFile, lines.join('\n') + '\n');
  return newRecord;
}

function setBonus(textFile, driverID, date, newValue) {
  let lines = fs.readFileSync(textFile, 'utf8').split('\n').filter(l => l.trim());
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

function countBonusPerMonth(textFile, driverID, month) {
  month = month.toString().padStart(2,'0');
  let lines = fs.readFileSync(textFile, 'utf8').split('\n').filter(l => l.trim());
  let found = false, count = 0;
  for (let line of lines) {
    let parts = line.split(',');
    if (parts[0] === driverID) {
      found = true;
      if (parts[2].split('-')[1] === month && parts[9] === 'true') count++;
    }
  }
  return found ? count : -1;
}

function getTotalActiveHoursPerMonth(textFile, driverID, month) {
  let lines = fs.readFileSync(textFile, 'utf8').split('\n').filter(l => l.trim());
  let total = 0;
  for (let line of lines) {
    let parts = line.split(',');
    if (parts[0] === driverID && Number(parts[2].split('-')[1]) === month) {
      total += parseDuration(parts[7]);
    }
  }
  return formatDuration(total);
}

function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
  let rates = fs.readFileSync(rateFile, 'utf8').split('\n').filter(l => l.trim());
  let dayOff = '';
  for (let line of rates) {
    let parts = line.split(',');
    if (parts[0] === driverID) { dayOff = parts[1]; break; }
  }
  let shifts = fs.readFileSync(textFile, 'utf8').split('\n').filter(l => l.trim());
  let total = 0;
  for (let line of shifts) {
    let parts = line.split(',');
    if (parts[0] === driverID && Number(parts[2].split('-')[1]) === month) {
      let weekday = new Date(parts[2]).getDay();
      if (weekday !== dayMap[dayOff]) {
        let isEid = parts[2] >= '2025-04-10' && parts[2] <= '2025-04-30';
        total += isEid ? 21600 : 30240;
      }
    }
  }
  return formatDuration(total - (bonusCount * 7200));
}

function getNetPay(driverID, actualHours, requiredHours, rateFile) {
  let rates = fs.readFileSync(rateFile, 'utf8').split('\n').filter(l => l.trim());
  let basePay = 0, tier = 0;
  for (let line of rates) {
    let parts = line.split(',');
    if (parts[0] === driverID) { basePay = Number(parts[2]); tier = Number(parts[3]); break; }
  }
  let allowed = [0,50,20,10,3][tier];
  let missing = parseDuration(requiredHours) - parseDuration(actualHours);
  if (missing <= 0) return basePay;
  let billable = Math.max(0, Math.floor(missing / 3600) - allowed);
  return basePay - (billable * Math.floor(basePay / 185));
}

module.exports = { getShiftDuration, getIdleTime, getActiveTime, metQuota, addShiftRecord, setBonus, countBonusPerMonth, getTotalActiveHoursPerMonth, getRequiredHoursPerMonth, getNetPay };