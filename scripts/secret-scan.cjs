const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

function candidateFiles() {
  const output = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  return output.toString('utf8').split('\0').filter(Boolean).sort();
}

const rules = [
  ['private-key-pem', /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/i],
  ['credentialed-url', /https?:\/\/[^\s/:]+:[^\s/@]+@/i],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~+/-]{16,}={0,2}\b/i],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['openai-key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['github-token', /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/],
  ['sensitive-assignment', /\b(?:private[_-]?key|mnemonic|seed[_-]?phrase|keystore[_-]?password|api[_-]?(?:key|secret)|rpc[_-]?(?:key|secret)|alchemy[_-]?(?:key|secret)|signing[_-]?(?:key|secret)|hmac[_-]?secret)\b\s*[=:]\s*["']?[^\s"';,#}]{8,}/i],
  ['secret-query-parameter', /[?&](?:api[_-]?key|key|token|secret|signature)=[A-Za-z0-9._~+/-]{8,}/i]
];

const findings = [];
for (const file of candidateFiles()) {
  const content = fs.readFileSync(file);
  if (content.includes(0)) continue;
  const lines = content.toString('utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const [rule, pattern] of rules) {
      if (pattern.test(lines[index])) findings.push({ file, line: index + 1, rule });
    }
  }
}

if (findings.length) {
  console.error(JSON.stringify({ status: 'BLOCKED', findings }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: 'PASS', scannedFiles: candidateFiles().length, exposedValuesPrinted: false }, null, 2));
