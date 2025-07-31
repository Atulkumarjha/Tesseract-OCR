const express = require('express');
const multer = require("multer");
const path = require('path');
const Tesseract = require('tesseract.js');

const app = express();
app.use(express.static('public'));
app.set('view engine', 'ejs');

app.listen(3000, () => {
    console.log("Server is running on port 3000");
})

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads'),
    filename: (req, file, cb) => 
        cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({ 
    storage
});

app.get('/', (req,res) => {
    res.render('index', { aadhaarData: null, panData: null });
});

app.post('/upload', upload.fields([{ name: "aadhaar" }, { name: 'pan' }]), async (req,res) => {
    const files = req.files;
    let aadhaarText ='', panText='';

    const sharp = require('sharp');
    const getImageSize = async (filePath) => {
        try {
            const metadata = await sharp(filePath).metadata();
            return { width: metadata.width, height: metadata.height };
        } catch (err) {
            return { width: 0, height: 0 };
        }
    };

    // Stricter filter for name extraction: only alphabetic, no numbers/special chars, not generic labels
    const isLikelyName = line =>
        /^[A-Za-z ]{3,}$/.test(line) &&
        !/^(MALE|FEMALE|DOB|YEAR|GOVERNMENT|INDIA|AADHAAR|UNIQUE IDENTIFICATION AUTHORITY|INCOME TAX DEPARTMENT|Permanent Account Number|GOVT)$/i.test(line);

    // High-level refinement for Aadhaar name and number extraction
    function parseAadhaar(text) {
        // Clean up common OCR mistakes
        text = text.replace(/[Oo]/g, '0').replace(/[lI]/g, '1');
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        let name = '';
        let aadhaarNumber = '';

        // Log all lines for debugging
        console.log('Aadhaar OCR lines:', lines);

        // Robust Aadhaar number extraction: allow spaces, dashes, and OCR mistakes
        const aadhaarMatch = text.match(/([0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4})/);
        if (aadhaarMatch) aadhaarNumber = aadhaarMatch[1].replace(/[^0-9]/g, '');

        // Heuristic 1: Look for a line before the Aadhaar number that is a likely name
        if (aadhaarNumber) {
            const idx = lines.findIndex(line => line.replace(/\D/g, '') === aadhaarNumber);
            if (idx > 0 && isLikelyName(lines[idx - 1])) {
                name = lines[idx - 1];
            }
        }

        // Heuristic 2: Look for a line after 'Name' that is a likely name
        if (!name) {
            for (let i = 0; i < lines.length; i++) {
                if (/name/i.test(lines[i]) && i + 1 < lines.length && isLikelyName(lines[i + 1])) {
                    name = lines[i + 1];
                    break;
                }
            }
        }

        // Heuristic 3: Find first line that is a likely name
        if (!name) {
            name = lines.find(isLikelyName);
        }

        // Fallback: line after DOB or Year of Birth
        if (!name) {
            for (let i = 0; i < lines.length; i++) {
                if (/DOB|Year/i.test(lines[i]) && i + 1 < lines.length && isLikelyName(lines[i + 1])) {
                    name = lines[i + 1];
                    break;
                }
            }
        }

        return { name, aadhaarNumber };
    }

    // High-level refinement for PAN name extraction
    function parsePAN(text) {
        // Clean up common OCR mistakes
        text = text.replace(/[Oo]/g, '0').replace(/[lI]/g, '1');
        const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        let name = '';
        let panNumber = '';

        // Log all lines for debugging
        console.log('PAN OCR lines:', lines);

        // PAN number format: 5 letters, 4 digits, 1 letter
        const panMatch = text.match(/[A-Z]{5}[0-9]{4}[A-Z]/);
        if (panMatch) panNumber = panMatch[0];

        // Heuristic 1: Look for a line before the PAN number that is a likely name
        if (panNumber) {
            const idx = lines.findIndex(line => line.includes(panNumber));
            if (idx > 0 && isLikelyName(lines[idx - 1])) {
                name = lines[idx - 1];
            }
        }

        // Heuristic 2: Look for a line after 'Name' that is a likely name
        if (!name) {
            for (let i = 0; i < lines.length; i++) {
                if (/name/i.test(lines[i]) && i + 1 < lines.length && isLikelyName(lines[i + 1])) {
                    name = lines[i + 1];
                    break;
                }
            }
        }

        // Heuristic 3: Find first line that is a likely name
        if (!name) {
            name = lines.find(isLikelyName);
        }

        // Fallback: line after 'Father' or 'S/O', 'D/O', 'W/O'
        if (!name) {
            for (let i = 0; i < lines.length; i++) {
                if (/(Father|S\/O|D\/O|W\/O)/i.test(lines[i]) && i + 1 < lines.length && isLikelyName(lines[i + 1])) {
                    name = lines[i + 1];
                    break;
                }
            }
        }

        return { name, panNumber };
    }

    // Advanced image preprocessing: higher resolution, denoise, more aggressive contrast/sharpening, adaptive threshold
    const preprocessImage = async (inputPath, outputPath) => {
        let image = sharp(inputPath)
            .resize({ width: 1800, height: 1800, fit: 'inside' })
            .grayscale()
            .sharpen({ sigma: 3 })
            .modulate({ brightness: 1.3, contrast: 2.5 })
            .median(5)
            .threshold(100);
        await image.toFile(outputPath);
        console.log('Processed image saved at:', outputPath);
    };

    
    if(files.aadhaar) {
        const size = await getImageSize(files.aadhaar[0].path);
        if (size.width < 3 || size.height < 3) {
            aadhaarText = 'Image too small for OCR.';
        } else {
            // Crop the whole image for better accuracy
            const processedPath = files.aadhaar[0].path + '-processed.png';
            await preprocessImage(files.aadhaar[0].path, processedPath);
            // Try multiple PSM modes and pick the best result
            let bestText = '', bestName = '', bestConfidence = 0;
            for (const psm of [1, 7, 6, 11, 3, 4, 12, 13]) {
                const result = await Tesseract.recognize(
                    processedPath,
                    'eng',
                    {
                        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ',
                        preserve_interword_spaces: 1,
                        psm
                    }
                );
                let text = result.data.text;
                // Post-process OCR text: remove non-ASCII, extra spaces
                text = text.replace(/[^\x20-\x7E\n]/g, '').replace(/ +/g, ' ').replace(/\n{2,}/g, '\n');
                console.log(`Aadhaar OCR (PSM ${psm}):\n`, text);
                const nameCandidate = parseAadhaar(text).name;
                const confidence = result.data.confidence || 0;
                if (nameCandidate && confidence > bestConfidence) {
                    bestText = text;
                    bestName = nameCandidate;
                    bestConfidence = confidence;
                }
            }
            aadhaarText = bestText;
            console.log('Aadhaar OCR Best Text:', aadhaarText);
        }
    }

    if(files.pan) {
        const size = await getImageSize(files.pan[0].path);
        if (size.width < 3 || size.height < 3) {
            panText = 'Image too small for OCR.';
        } else {
            // Crop the whole image for better accuracy
            const processedPath = files.pan[0].path + '-processed.png';
            await preprocessImage(files.pan[0].path, processedPath);
            let bestText = '', bestName = '', bestConfidence = 0;
            for (const psm of [1, 7, 6, 11, 3, 4, 12, 13]) {
                const result = await Tesseract.recognize(
                    processedPath,
                    'eng',
                    {
                        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ',
                        preserve_interword_spaces: 1,
                        psm
                    }
                );
                let text = result.data.text;
                // Post-process OCR text: remove non-ASCII, extra spaces
                text = text.replace(/[^\x20-\x7E\n]/g, '').replace(/ +/g, ' ').replace(/\n{2,}/g, '\n');
                console.log(`PAN OCR (PSM ${psm}):\n`, text);
                const nameCandidate = parsePAN(text).name;
                const confidence = result.data.confidence || 0;
                if (nameCandidate && confidence > bestConfidence) {
                    bestText = text;
                    bestName = nameCandidate;
                    bestConfidence = confidence;
                }
            }
            panText = bestText;
            console.log('PAN OCR Best Text:', panText);
        }
    }


    const aadhaarData = aadhaarText ? parseAadhaar(aadhaarText) : null;
    const panData = panText ? parsePAN(panText) : null;

    res.render('index', { aadhaarData, panData });
});

