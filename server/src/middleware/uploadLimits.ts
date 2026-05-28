import multer from 'multer';
import { ALLOWED_LOGO_MIMES, MAX_LOGO_BYTES } from '../lib/branding';

/** In-memory multer storage capped at 1 MB; mime-whitelisted for logos. */
export const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_LOGO_MIMES.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`unsupported mime: ${file.mimetype}`));
  },
});
