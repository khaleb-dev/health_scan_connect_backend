import express from 'express';
import QRCode from 'qrcode';
import { body, validationResult } from 'express-validator';
import Patient from '../models/Patient.js';
import { protect, requireStaff } from '../middleware/auth.js';

const router = express.Router();

// @desc    Generate QR code image
// @route   POST /api/qr/generate
// @access  Private/Staff
router.post('/generate', protect, requireStaff, [
    body('data').notEmpty().withMessage('QR code data is required')
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { data, options = {} } = req.body;

        // Default QR code options
        const qrOptions = {
            errorCorrectionLevel: 'M',
            type: 'image/png',
            quality: 0.92,
            margin: 1,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            },
            width: 256,
            ...options
        };

        // Generate QR code as data URL
        const qrCodeDataURL = await QRCode.toDataURL(JSON.stringify(data), qrOptions);

        res.json({
            success: true,
            data: {
                qrCodeImage: qrCodeDataURL,
                data: data
            }
        });
    } catch (error) {
        console.error('Generate QR code error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error generating QR code'
        });
    }
});

// @desc    Generate QR code for patient
// @route   POST /api/qr/patient/:id
// @access  Private/Staff
router.post('/patient/:id', protect, requireStaff, async (req, res) => {
    try {
        const patient = await Patient.findById(req.params.id);
        if (!patient) {
            return res.status(404).json({
                success: false,
                message: 'Patient not found'
            });
        }

        // Generate new QR code data
        const qrCode = patient.generateQRCode();
        await patient.save();

        // Generate QR code image
        const qrOptions = {
            errorCorrectionLevel: 'M',
            type: 'image/png',
            quality: 0.92,
            margin: 1,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            },
            width: 256
        };

        const qrCodeImage = await QRCode.toDataURL(qrCode.code, qrOptions);

        res.json({
            success: true,
            data: {
                patient: patient,
                qrCode: qrCode.code,
                qrCodeImage: qrCodeImage,
                expiresAt: qrCode.expiresAt
            }
        });
    } catch (error) {
        console.error('Generate patient QR code error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error generating patient QR code'
        });
    }
});

// @desc    Validate QR code
// @route   POST /api/qr/validate
// @access  Private/Staff
router.post('/validate', protect, requireStaff, [
    body('qrCode').notEmpty().withMessage('QR code data is required')
], async (req, res) => {
    try {
        // Check for validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                errors: errors.array()
            });
        }

        const { qrCode } = req.body;

        try {
            // Parse QR code data
            const qrData = JSON.parse(qrCode);

            // Check if QR code is expired
            const expiryDate = new Date(qrData.expiryDate);
            const now = new Date();

            if (expiryDate < now) {
                return res.status(400).json({
                    success: false,
                    message: 'QR code has expired',
                    data: {
                        isValid: false,
                        reason: 'expired',
                        expiryDate: qrData.expiryDate
                    }
                });
            }

            // Find patient
            const patient = await Patient.findById(qrData.patientId);
            if (!patient) {
                return res.status(404).json({
                    success: false,
                    message: 'Patient not found',
                    data: {
                        isValid: false,
                        reason: 'patient_not_found'
                    }
                });
            }

            // Check if QR code is active
            if (!patient.qrCode.isActive) {
                return res.status(400).json({
                    success: false,
                    message: 'QR code is not active',
                    data: {
                        isValid: false,
                        reason: 'inactive'
                    }
                });
            }

            // Check if QR code matches patient's current QR code
            if (patient.qrCode.code !== qrCode) {
                return res.status(400).json({
                    success: false,
                    message: 'QR code is outdated',
                    data: {
                        isValid: false,
                        reason: 'outdated'
                    }
                });
            }

            res.json({
                success: true,
                message: 'QR code is valid',
                data: {
                    isValid: true,
                    patient: patient,
                    timeRemaining: Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24)) // days remaining
                }
            });
        } catch (parseError) {
            return res.status(400).json({
                success: false,
                message: 'Invalid QR code format',
                data: {
                    isValid: false,
                    reason: 'invalid_format'
                }
            });
        }
    } catch (error) {
        console.error('Validate QR code error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error validating QR code'
        });
    }
});

// @desc    Get QR code statistics
// @route   GET /api/qr/stats
// @access  Private/Staff
router.get('/stats', protect, requireStaff, async (req, res) => {
    try {
        const now = new Date();

        // Get QR code statistics
        const totalQRCodes = await Patient.countDocuments({ 'qrCode.isActive': true });
        const expiredQRCodes = await Patient.countDocuments({
            'qrCode.expiresAt': { $lt: now }
        });
        const validQRCodes = await Patient.countDocuments({
            'qrCode.isActive': true,
            'qrCode.expiresAt': { $gte: now }
        });

        // Get QR codes expiring soon (within 24 hours)
        const expiringSoon = await Patient.countDocuments({
            'qrCode.isActive': true,
            'qrCode.expiresAt': {
                $gte: now,
                $lte: new Date(now.getTime() + 24 * 60 * 60 * 1000)
            }
        });

        // Get QR codes generated today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const generatedToday = await Patient.countDocuments({
            'qrCode.createdAt': { $gte: today }
        });

        res.json({
            success: true,
            data: {
                totalQRCodes,
                validQRCodes,
                expiredQRCodes,
                expiringSoon,
                generatedToday
            }
        });
    } catch (error) {
        console.error('Get QR stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

export default router;
