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

cosnt storage = multer.diskstorage