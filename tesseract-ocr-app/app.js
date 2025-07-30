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

    if(files.aadhaar) {
        const result= await Tesseract.recognize(
            files.aadhaar[0].path,
            'eng'
        );
        aadhaarText = result.data.text;
    }

    if(files.pan) {
        const result=await Tesseract.recognize(
            files.pan[0].path,
            'eng'
        );
        panText = result.data.text;
    }

    const parseAadhaar = (text) => {
        return {
            name: (text.match(/[A-Z ]{3,}/) || [])[0],
            aadhaarNumber: (text.match(/\d{4} \d{4} \d{4}/) || [])[0]
        };
    };
    
    const parsePAN = (text) => {
        return {
            name: (text.match(/[A-Z ]{3,}/) || [])[0],
            aadhaarNumber: (text.match(/\d{4} \d{4} \d{4}/) || [])[0]
        };
    };

    const aadhaarData = aadhaarText ? parseAadhaar(aadhaarText) : null;
    const panData = panText ? parsePAN(panText) : null;

    res.render('index', { aadhaarData, panData });
});

