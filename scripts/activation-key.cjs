#!/usr/bin/env node
// Administrator-only tool. Neither this file nor its private key is packaged in the app.
const fs = require('node:fs')
const path = require('node:path')
const { generateKeyPairSync, createPublicKey, sign, randomUUID } = require('node:crypto')
const { PRODUCT, normalizeEmail, verifyActivation } = require('../apps/analytics-desktop/electron/activation.cjs')

function run(argv) {
  const [command, ...args] = argv
  const option = (name) => {
    const index = args.indexOf(`--${name}`)
    if (index === -1 || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`--${name} is required`)
    return args[index + 1]
  }
  if (command === 'init') {
    const privatePath = path.resolve(option('private'))
    const publicPath = path.resolve(option('public'))
    if (fs.existsSync(privatePath) || fs.existsSync(publicPath)) throw new Error('Refusing to replace existing issuer keys.')
    const keys = generateKeyPairSync('ed25519', {
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    })
    fs.mkdirSync(path.dirname(privatePath), { recursive: true })
    fs.mkdirSync(path.dirname(publicPath), { recursive: true })
    fs.writeFileSync(privatePath, keys.privateKey, { flag: 'wx', mode: 0o600 })
    fs.writeFileSync(publicPath, keys.publicKey, { flag: 'wx' })
    console.log('Issuer keys created. Back up the private key securely; distribute only the public key with the app.')
    return
  }
  if (command === 'issue') {
    const email = normalizeEmail(option('email'))
    const expiration = option('expires')
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(expiration)) throw new Error('Use an exact UTC expiry, for example 2027-10-04T00:00:00Z.')
    const expires = Date.parse(expiration)
    if (!Number.isFinite(expires) || new Date(expires).toISOString().replace('.000Z', 'Z') !== expiration || expires <= Date.now()) throw new Error('Expiry must be a valid future UTC date.')
    const privateKey = fs.readFileSync(path.resolve(option('private')), 'utf8')
    const claims = { v: 1, product: PRODUCT, id: randomUUID(), email, nbf: Math.floor(Date.now() / 1000), exp: Math.floor(expires / 1000) }
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    const message = `GEA1.${payload}`
    const key = `${message}.${sign(null, Buffer.from(message), privateKey).toString('base64url')}`
    verifyActivation(email, key, createPublicKey(privateKey))
    console.log(key)
    return
  }
  throw new Error('Usage: node scripts/activation-key.cjs init --private <pem> --public <pem> | issue --private <pem> --email <email> --expires <UTC timestamp>')
}

try { run(process.argv.slice(2)) } catch (error) { console.error(error.message); process.exitCode = 1 }
