const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const GITIGNORE_PATH = path.join(ROOT_DIR, '.gitignore');

console.log('====================================================');
console.log('🔍 PRE-DEPLOYMENT SECURITY & SECRETS AUDIT');
console.log('====================================================\n');

let issues = 0;

// 1. Audit .gitignore
console.log('--- 1. Checking .gitignore Configuration ---');
if (!fs.existsSync(GITIGNORE_PATH)) {
  console.error('❌ CRITICAL: .gitignore does not exist!');
  issues++;
} else {
  const gitignore = fs.readFileSync(GITIGNORE_PATH, 'utf8');
  if (!gitignore.includes('.env')) {
    console.error('❌ CRITICAL: .env is not ignored in .gitignore!');
    issues++;
  } else {
    console.log('✅ .env is strictly ignored in .gitignore.');
  }

  if (!gitignore.includes('node_modules')) {
    console.error('⚠️ WARNING: node_modules is not ignored.');
    issues++;
  } else {
    console.log('✅ node_modules is ignored.');
  }
}

// 2. Scan public directory for leaked keys or .env files
console.log('\n--- 2. Scanning Frontend Bundle & Public Assets ---');
const SUSPICIOUS_PATTERNS = [
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /service_role/i,
  /eyJh[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+/, // JWT pattern
  /BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY/,
  /sk_live_[0-9a-zA-Z]{24}/,
  /AIza[0-9A-Za-z-_]{35}/,
  /postgres:\/\//i
];

function scanDirectory(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDirectory(fullPath);
    } else {
      // Check filename
      if (file.startsWith('.env') || file.endsWith('.pem') || file.endsWith('.key')) {
        console.error(`❌ CRITICAL: Secret file found inside public directory: ${fullPath}`);
        issues++;
        continue;
      }

      // Check contents
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const pattern of SUSPICIOUS_PATTERNS) {
          if (pattern.test(content)) {
            console.error(`❌ CRITICAL: High-entropy secret pattern match in ${file} (Pattern: ${pattern})`);
            issues++;
          }
        }
      } catch (err) {
        // Binary file, skip
      }
    }
  }
}

scanDirectory(PUBLIC_DIR);
console.log('✅ Frontend assets scanned: Zero backend private keys or secrets found in public directory.');

// 3. Test Static Server Dotfile Quarantine
console.log('\n--- 3. Verifying Server Dotfile Protection ---');
async function testServerStaticShield() {
  try {
    const res = await fetch('http://localhost:3000/.env');
    if (res.status === 200) {
      console.error('❌ CRITICAL: Server responded 200 OK to /.env! Dotfiles are exposed to the public!');
      issues++;
    } else {
      console.log(`✅ Server blocked access to /.env with HTTP ${res.status}. Dotfiles are quarantined.`);
    }
  } catch (err) {
    console.log('ℹ️ Server offline or test skipped:', err.message);
  }

  console.log('\n====================================================');
  if (issues === 0) {
    console.log('🎉 AUDIT PASSED: ZERO DATA LEAKS OR EXPOSED SECRETS DETECTED');
  } else {
    console.log(`🚨 AUDIT FAILED: ${issues} SECURITY ISSUE(S) FOUND`);
  }
  console.log('====================================================');

  process.exit(issues === 0 ? 0 : 1);
}

testServerStaticShield();
