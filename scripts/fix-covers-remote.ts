// GitHub Actions entry point. The shared implementation deliberately runs
// without LOCAL_MUSIC_DIR, so eligibility is based only on remote D1 data.
process.argv.push("--remote");
process.argv.push("--since-hours=48");
await import("./fix-covers.js");