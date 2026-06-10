const express = require('express');
const db = require('../db');
const { requireApproved } = require('../middleware/auth');
const router = express.Router();

router.use(requireApproved);

function emitEntry(req, event, data) {
  const io = req.app.get('io');
  if (io) io.emit(event, data);
}

// ============ SLEEP ============

router.get('/sleep', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  res.json(db.getSleepEntriesByDate(date));
});

router.post('/sleep', (req, res) => {
  try {
    const { type, start_time, end_time, notes, date } = req.body;
    const validTypes = ['morning_wake', 'nap1', 'nap2', 'nap3', 'nap4', 'night_sleep'];
    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid sleep type' });
    }
    if (!start_time || !date) {
      return res.status(400).json({ error: 'start_time and date are required' });
    }
    const result = db.createSleepEntry(req.session.userId, type, start_time, end_time, notes, date);
    const entry = { id: result.lastInsertRowid, user_id: req.session.userId, username: req.session.username, type, start_time, end_time: end_time || null, notes: notes || null, date };
    emitEntry(req, 'entry:created', { entryType: 'sleep', entry });
    res.json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/sleep/:id', (req, res) => {
  try {
    const { type, start_time, end_time, notes } = req.body;
    const isAdmin = req.session.userRole === 'admin';
    const result = db.updateSleepEntry(parseInt(req.params.id), isAdmin ? null : req.session.userId, type, start_time, end_time, notes);
    if (result.changes === 0) {
      // Try admin update
      if (!isAdmin) return res.status(404).json({ error: 'Entry not found or not yours' });
    }
    const entry = { id: parseInt(req.params.id), type, start_time, end_time: end_time || null, notes: notes || null };
    emitEntry(req, 'entry:updated', { entryType: 'sleep', entry });
    res.json({ success: true, entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/sleep/:id', (req, res) => {
  try {
    const isAdmin = req.session.userRole === 'admin';
    db.deleteSleepEntry(parseInt(req.params.id), req.session.userId, isAdmin);
    emitEntry(req, 'entry:deleted', { entryType: 'sleep', id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ FEEDING ============

router.get('/feeding', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  res.json(db.getFeedingEntriesByDate(date));
});

router.post('/feeding', (req, res) => {
  try {
    const { amount, unit, time, notes, date } = req.body;
    if (amount === undefined || amount === null || !time || !date) {
      return res.status(400).json({ error: 'amount, time and date are required' });
    }
    const validUnit = ['ml', 'oz'].includes(unit) ? unit : 'ml';
    const result = db.createFeedingEntry(req.session.userId, parseFloat(amount), validUnit, time, notes, date);
    const entry = { id: result.lastInsertRowid, user_id: req.session.userId, username: req.session.username, amount: parseFloat(amount), unit: validUnit, time, notes: notes || null, date };
    emitEntry(req, 'entry:created', { entryType: 'feeding', entry });
    res.json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/feeding/:id', (req, res) => {
  try {
    const { amount, unit, time, notes } = req.body;
    const isAdmin = req.session.userRole === 'admin';
    db.updateFeedingEntry(parseInt(req.params.id), isAdmin ? null : req.session.userId, parseFloat(amount), unit, time, notes);
    const entry = { id: parseInt(req.params.id), amount: parseFloat(amount), unit, time, notes: notes || null };
    emitEntry(req, 'entry:updated', { entryType: 'feeding', entry });
    res.json({ success: true, entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/feeding/:id', (req, res) => {
  try {
    const isAdmin = req.session.userRole === 'admin';
    db.deleteFeedingEntry(parseInt(req.params.id), req.session.userId, isAdmin);
    emitEntry(req, 'entry:deleted', { entryType: 'feeding', id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ DIAPER ============

router.get('/diaper', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  res.json(db.getDiaperEntriesByDate(date));
});

router.post('/diaper', (req, res) => {
  try {
    const { type, time, notes, date } = req.body;
    if (!['wet', 'dirty', 'both'].includes(type) || !time || !date) {
      return res.status(400).json({ error: 'type, time and date are required' });
    }
    const result = db.createDiaperEntry(req.session.userId, type, time, notes, date);
    const entry = { id: result.lastInsertRowid, user_id: req.session.userId, username: req.session.username, type, time, notes: notes || null, date };
    emitEntry(req, 'entry:created', { entryType: 'diaper', entry });
    res.json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/diaper/:id', (req, res) => {
  try {
    const { type, time, notes } = req.body;
    const isAdmin = req.session.userRole === 'admin';
    db.updateDiaperEntry(parseInt(req.params.id), isAdmin ? null : req.session.userId, type, time, notes);
    const entry = { id: parseInt(req.params.id), type, time, notes: notes || null };
    emitEntry(req, 'entry:updated', { entryType: 'diaper', entry });
    res.json({ success: true, entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/diaper/:id', (req, res) => {
  try {
    const isAdmin = req.session.userRole === 'admin';
    db.deleteDiaperEntry(parseInt(req.params.id), req.session.userId, isAdmin);
    emitEntry(req, 'entry:deleted', { entryType: 'diaper', id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============ MEDICATION ============

router.get('/medication', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  res.json(db.getMedicationEntriesByDate(date));
});

router.get('/medication/reminders', (req, res) => {
  res.json(db.getUpcomingMedicationReminders());
});

// Check for duplicate dose
router.post('/medication/check-duplicate', (req, res) => {
  try {
    const { name, next_dose_reminder } = req.body;
    if (!name) return res.json({ duplicate: false });

    // Look back 24 hours for same medication
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = db.getRecentMedicationByName(name, since);

    if (recent.length === 0) return res.json({ duplicate: false });

    const latest = recent[0];
    if (latest.next_dose_reminder) {
      const reminderTime = new Date(latest.next_dose_reminder).getTime();
      const now = Date.now();
      if (now < reminderTime) {
        return res.json({
          duplicate: true,
          warning: `${name} was last given by ${latest.username} at ${new Date(latest.time_administered).toLocaleTimeString()}. Next dose not due until ${new Date(latest.next_dose_reminder).toLocaleTimeString()}.`,
          lastEntry: latest,
        });
      }
    }

    res.json({ duplicate: false, lastEntry: latest });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/medication', (req, res) => {
  try {
    const { name, dosage, time_administered, next_dose_reminder, notes, date } = req.body;
    if (!name || !dosage || !time_administered || !date) {
      return res.status(400).json({ error: 'name, dosage, time_administered and date are required' });
    }
    const result = db.createMedicationEntry(req.session.userId, name, dosage, time_administered, next_dose_reminder, notes, date);
    const entry = { id: result.lastInsertRowid, user_id: req.session.userId, username: req.session.username, name, dosage, time_administered, next_dose_reminder: next_dose_reminder || null, notes: notes || null, date };
    emitEntry(req, 'entry:created', { entryType: 'medication', entry });
    res.json(entry);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/medication/:id', (req, res) => {
  try {
    const { name, dosage, time_administered, next_dose_reminder, notes } = req.body;
    const isAdmin = req.session.userRole === 'admin';
    db.updateMedicationEntry(parseInt(req.params.id), isAdmin ? null : req.session.userId, name, dosage, time_administered, next_dose_reminder, notes);
    const entry = { id: parseInt(req.params.id), name, dosage, time_administered, next_dose_reminder: next_dose_reminder || null, notes: notes || null };
    emitEntry(req, 'entry:updated', { entryType: 'medication', entry });
    res.json({ success: true, entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/medication/:id', (req, res) => {
  try {
    const isAdmin = req.session.userRole === 'admin';
    db.deleteMedicationEntry(parseInt(req.params.id), req.session.userId, isAdmin);
    emitEntry(req, 'entry:deleted', { entryType: 'medication', id: parseInt(req.params.id) });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all entries for a date (combined timeline)
router.get('/all', (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const sleep = db.getSleepEntriesByDate(date).map(e => ({ ...e, entryType: 'sleep', sortTime: e.start_time }));
  const feeding = db.getFeedingEntriesByDate(date).map(e => ({ ...e, entryType: 'feeding', sortTime: e.time }));
  const diaper = db.getDiaperEntriesByDate(date).map(e => ({ ...e, entryType: 'diaper', sortTime: e.time }));
  const medication = db.getMedicationEntriesByDate(date).map(e => ({ ...e, entryType: 'medication', sortTime: e.time_administered }));

  const all = [...sleep, ...feeding, ...diaper, ...medication].sort((a, b) => {
    return a.sortTime.localeCompare(b.sortTime);
  });

  res.json(all);
});

// Calendar: get days with entries in a month
router.get('/calendar/:year/:month', (req, res) => {
  const { year, month } = req.params;
  const dates = db.getDatesWithEntries(parseInt(year), parseInt(month));
  res.json(dates);
});

module.exports = router;
