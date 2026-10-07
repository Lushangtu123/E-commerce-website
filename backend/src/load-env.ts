// Side-effect import: load .env before any module reads process.env. Must be the entry file's first import.
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
