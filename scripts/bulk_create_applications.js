#!/usr/bin/env node

/**
 * Bulk create applications for testing
 * Usage: node scripts/bulk_create_applications.js
 */

const db = require('../db');
const crypto = require('crypto');

const NAMES = [
  'Maria Mendoza Flores',
  'Eduardo Pascual Reyes',
  'Ana Santos Reyes',
  'Quirino Fernandez Dela Cruz',
  'Marites Pascual Gonzales',
  'Victor Mendoza Valdez',
  'Odessa Aquino Soriano',
  'Bayani Ocampo Torres',
  'Angelica Bautista Reyes',
  'Gerardo Villanueva Domingo',
  'Antonio Salazar Salazar',
  'Isagani Cruz Salazar',
  'Zaldy Villanueva Ocampo',
  'Miguel Reyes Rivera',
  'Cesar Cruz Zamora',
  'Eduardo Castillo Ramos',
  'Herminio Aquino Aquino',
  'Bayani Cruz Domingo',
  'Herminia Ramos Mendoza',
  'Bayani Pascual Flores',
  'Rosalinda Reyes Flores',
  'Perla Flores Fernandez',
  'Alfredo Domingo Abad',
  'Remedios Aguilar Fernandez',
  'Katrina Salazar Garcia',
  'Renato Pascual Salazar',
  'Victor Del Rosario Abad',
  'Bernadette Ramos Garcia',
  'Ricardo Reyes Zamora',
  'Carlos Del Rosario Domingo',
  'Isagani Fernandez Pascual',
  'Teodoro Santos Rivera',
  'Lourdes Pascual Uy',
  'Fernando Bautista Villanueva',
  'Nestor Santos Tolentino',
  'Leonora Navarro Uy',
  'Eduardo Garcia Yap',
  'Juliana Torres Garcia',
  'Carlos Pascual Uy',
  'Veronica Santos Domingo',
  'Jose Bautista Bernardo',
  'Domingo Ramos Santos',
  'Ulysses Cruz Reyes',
  'Rosalinda Cruz Uy',
  'Rafael Ocampo Rivera',
  'Teodoro Aquino Ramos',
  'Wilfredo Del Rosario Torres',
  'Odessa Torres Soriano',
  'Herminio Salazar Abad',
  'Manuel Ramos Flores',
  'Jose Domingo Salazar',
  'Danilo Santos Reyes',
  'Ana Ramos Reyes',
  'Salome Flores Reyes',
  'Bayani Aguilar Torres',
  'Ulysses Domingo Navarro',
  'Oscar Del Rosario Torres',
  'Leandro Villanueva Gonzales',
  'Ramon Bautista Santos',
  'Fernando Bautista Flores',
  'Salvador Salazar Garcia',
  'Bayani Salazar Flores',
  'Rosario Salazar Valdez',
  'Herminia Bautista Santos',
  'Herminia Santos Reyes',
  'Salome Ramos Mendoza',
  'Oscar Torres Zamora',
  'Ramon Aquino Fernandez',
  'Isagani Mendoza Bernardo',
  'Estrella Garcia Gonzales',
];

const SCHOOLS = [
  'Angat National High School',
  'Bulacan State University',
  'De La Salle University',
  'University of the Philippines',
  'Miriam College',
  'Lyceum-Northwestern University',
  'Davao Oriental State University',
  'Central Mindanao University',
];

const BARANGAYS = [
  'Angat Proper',
  'Abugan',
  'Biyubenua',
  'Daang Ilog',
  'Kapatagan',
];

const TRACKS = [
  'Academic Track',
  'Technical-Professional Track - ICT / Computer Systems Servicing',
  'Technical-Professional Track - Home Economics / Cookery',
];

const DEGREES = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Nursing',
  'Bachelor of Science in Business Administration',
  'Bachelor of Science in Accountancy',
  'Bachelor of Science in Engineering',
];

const WHY_SCHOLAR = [
  'I want to finish my studies and help my family become stable.',
  'Education is the key to a better future for me and my family.',
  'I want to pursue my dreams through quality education.',
  'To break the cycle of poverty and provide a better life.',
  'I am committed to excellence in my studies.',
  'To serve my community through education.',
  'I want to be a role model for my younger siblings.',
];

const CAN_PROVIDE = [
  ['School Fees'],
  ['School Fees', 'Supplies'],
  ['School Fees', 'Supplies', 'Uniform'],
  ['School Fees', 'Supplies', 'Uniform', 'Shoes'],
  ['School Fees', 'Supplies', 'Uniform', 'Shoes', 'Allowance'],
  ['Supplies', 'Allowance'],
  ['Supplies'],
];

function parseName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts[parts.length - 1] || '',
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
  };
}

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomDate(startYear = 2000, endYear = 2008) {
  const year = startYear + Math.floor(Math.random() * (endYear - startYear + 1));
  const month = Math.floor(Math.random() * 12);
  const day = Math.floor(Math.random() * 28) + 1;
  const date = new Date(year, month, day);
  return date.toISOString().split('T')[0];
}

function calculateAge(dobString) {
  const dob = new Date(dobString);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return Math.max(14, Math.min(25, age));
}

function generateContact() {
  const areaCode = ['09' + Math.floor(Math.random() * 2)];
  const rest = Math.floor(Math.random() * 100000000).toString().padStart(8, '0');
  return `09${Math.floor(Math.random() * 999999999).toString().padStart(9, '0')}`;
}

async function createApplications() {
  console.log(`Creating ${NAMES.length} applications...`);

  for (let idx = 0; idx < NAMES.length; idx++) {
    const fullName = NAMES[idx];
    const nameObj = parseName(fullName);
    const firstName = nameObj.firstName;
    const lastName = nameObj.lastName;
    const middleName = nameObj.middleName;

    const username = `${firstName}${lastName}`.toLowerCase();
    const password = lastName;
    const email = `reqacc257@gmail.com`;
    const dob = generateRandomDate();
    const age = calculateAge(dob);
    const contact = generateContact();
    const eduLevel = idx % 2 === 0 ? 'SeniorHigh' : 'College';
    const school = getRandomItem(SCHOOLS);
    const grade = eduLevel === 'SeniorHigh' ? (11 + Math.floor(Math.random() * 2)) : (1 + Math.floor(Math.random() * 4));
    const degree = eduLevel === 'SeniorHigh' ? getRandomItem(TRACKS) : getRandomItem(DEGREES);
    const whyScholar = getRandomItem(WHY_SCHOLAR);
    const canProvide = getRandomItem(CAN_PROVIDE);
    const barangay = getRandomItem(BARANGAYS);
    const prevSchool = idx % 3 === 0 ? 'Angat National High School' : 'Bulacan Public School';
    const prevGrade = eduLevel === 'SeniorHigh' ? '10' : '11 - Senior High';
    const totalIncome = [15000, 20000, 25000, 30000, 35000, 40000][Math.floor(Math.random() * 6)];
    const totalExpense = [8000, 10000, 12000, 15000, 18000, 20000][Math.floor(Math.random() * 6)];
    const talents = ['Music', 'Sports', 'Drawing', 'Singing', 'Basketball'][Math.floor(Math.random() * 5)];
    const clubs = ['Student Council', 'STEM Club', 'Sports Team', 'Arts Club'][Math.floor(Math.random() * 4)];
    const ambition = [
      'Become a nurse',
      'Become a teacher',
      'Become an engineer',
      'Become a doctor',
      'Start a business',
      'Work in IT',
    ][Math.floor(Math.random() * 6)];

    const familyMembers = [
      {
        name: `${nameObj.lastName} Family Member 1`,
        relation: 'Father',
        age: age + 25,
        occupation: 'Laborer',
        income: Math.floor(totalIncome / 2),
      },
      {
        name: `${nameObj.lastName} Family Member 2`,
        relation: 'Mother',
        age: age + 23,
        occupation: 'Housewife',
        income: 0,
      },
    ];

    const properties = Math.random() > 0.7 ? ['Sariling Bahay'] : [];
    const gender = firstName.includes('a') || firstName.includes('ia') || firstName.includes('la') ? 'Female' : 'Male';

    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    const referenceNumber = `APP-${Date.now()}-${idx}`;
    const now = new Date().toISOString();

    try {
      await db.prepare(`
        INSERT INTO applications
          (sy, name, address, barangay, dob, age, gender, contact, email, religion, birthplace,
           talents, clubs, ambition, living_with, edu_level, prev_grade, prev_school,
           school, grade, degree, why_scholar, total_income, total_expense,
           family_members, properties, can_provide, status, date_label, password_hash, portal_username,
           reference_number, submitted_at, submitted_data, status_updated_at, status_history)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?)
      `).run(
        '2025-2026',
        fullName,
        `${Math.floor(Math.random() * 999)} Street Name`,
        barangay,
        dob,
        age,
        gender,
        contact,
        email,
        'Catholic',
        'Angat, Bulacan',
        talents,
        clubs,
        ambition,
        'Parents',
        eduLevel,
        prevGrade,
        prevSchool,
        school,
        grade,
        degree,
        whyScholar,
        totalIncome,
        totalExpense,
        JSON.stringify(familyMembers),
        JSON.stringify(properties),
        JSON.stringify(canProvide),
        'Pending Review',
        new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        passwordHash,
        username,
        referenceNumber,
        now,
        JSON.stringify({}),
        now,
        JSON.stringify([{ status: 'Pending Review', changedAt: now, note: 'Application submitted' }])
      );

      console.log(`✅ [${idx + 1}/${NAMES.length}] ${fullName} - User: ${username}, Pass: ${password}, Email: ${email}`);
    } catch (error) {
      console.error(`❌ [${idx + 1}/${NAMES.length}] ${fullName} - Error:`, error.message);
    }
  }

  console.log(`\n✅ All ${NAMES.length} applications created successfully!`);
  console.log(`\n📋 Login Credentials Summary:`);
  console.log(`Email for all accounts: ${`reqacc257@gmail.com`}`);
  console.log(`\nFormat: Username: FirstNameLastName, Password: LastName`);
  NAMES.slice(0, 5).forEach((name) => {
    const nameObj = parseName(name);
    console.log(`  Example: ${nameObj.firstName}${nameObj.lastName.toLowerCase()} / ${nameObj.lastName}`);
  });
  console.log(`  ... and ${NAMES.length - 5} more`);

  process.exit(0);
}

createApplications().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
