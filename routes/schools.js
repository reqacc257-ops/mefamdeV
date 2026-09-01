const router = require('express').Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');

router.get('/', requireRole('director', 'edu', 'program'), async (req, res) => {
  try {
    const schools = await db.prepare('SELECT * FROM schools ORDER BY name ASC').all();
    res.json(Array.isArray(schools) ? schools : []);
  } catch (error) {
    res.status(500).json({ error: 'Unable to load schools', details: error.message });
  }
});

router.get('/:id/config', requireRole('director', 'edu', 'program'), async (req, res) => {
  const schoolId = Number(req.params.id || 0);
  if (!schoolId) return res.status(400).json({ error: 'Missing school id' });

  try {
    const school = await db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
    const aliases = await db.prepare('SELECT * FROM subject_aliases WHERE school_id = ? OR school_id IS NULL ORDER BY school_id IS NULL, alias_text ASC').all(schoolId);
    const periods = await db.prepare('SELECT * FROM grading_periods WHERE school_id = ? ORDER BY school_year, period_type, period_number').all(schoolId);

    res.json({
      school: school || null,
      aliases: Array.isArray(aliases) ? aliases : [],
      periods: Array.isArray(periods) ? periods : [],
    });
  } catch (error) {
    res.status(500).json({ error: 'Unable to load school config', details: error.message });
  }
});

module.exports = router;
