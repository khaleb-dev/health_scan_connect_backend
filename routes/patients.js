import express from 'express';
import { body, validationResult } from 'express-validator';
import Patient from '../models/Patient.js';
import { protect, requireStaff } from '../middleware/auth.js';
import QRCode from 'qrcode';
import { assignDoctorToPatient } from '../services/doctorAssignment.js';

const router = express.Router();

// @desc    Register a new patient
// @route   POST /api/patients
// @access  Public (for patient self-registration)
router.post('/', [
    body('firstName').trim().isLength({ min: 2, max: 50 }).withMessage('First name must be between 2 and 50 characters'),
    body('lastName').trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be between 2 and 50 characters'),
    body('dateOfBirth').isISO8601().withMessage('Please enter a valid date of birth'),
    body('gender').isIn(['male', 'female', 'other', 'prefer-not-to-say']).withMessage('Please select a valid gender'),
    body('phone').matches(/^[\+]?[1-9][\d]{0,15}$/).withMessage('Please enter a valid phone number'),
    body('email').optional().isEmail().normalizeEmail().withMessage('Please enter a valid email'),
    body('currentSymptoms').trim().isLength({ min: 10, max: 1000 }).withMessage('Symptoms must be between 10 and 1000 characters'),
    body('medicalHistory').optional().trim().isLength({ max: 2000 }).withMessage('Medical history cannot exceed 2000 characters')
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

        const {
            firstName,
            lastName,
            dateOfBirth,
            gender,
            phone,
            email,
            address,
            emergencyContact,
            bloodType,
            allergies,
            currentSymptoms,
            medicalHistory,
            currentMedications,
            insurance,
            userId
        } = req.body;

        // Create patient
        const patient = new Patient({
            firstName,
            lastName,
            dateOfBirth,
            gender,
            phone,
            email,
            address,
            emergencyContact,
            bloodType,
            allergies,
            currentSymptoms,
            medicalHistory,
            currentMedications,
            insurance,
            userId
        });

        // Generate QR code
        patient.generateQRCode();

        // Save patient first
        await patient.save();

        // Assign doctor based on symptoms
        let assignment = null;
        try {
            assignment = await assignDoctorToPatient(patient._id, currentSymptoms);

            // Update patient with assigned doctor
            patient.assignedDoctor = assignment.assignment.doctor.id;
            await patient.save();
        } catch (assignmentError) {
            console.error('Doctor assignment failed:', assignmentError);
            // Continue without assignment - staff can manually assign later
        }

        // Populate assigned doctor for response
        await patient.populate('assignedDoctor', 'firstName lastName department specializations');

        res.status(201).json({
            success: true,
            data: patient,
            assignment: assignment?.assignment || null,
            message: assignment ?
                `Patient registered successfully and assigned to ${assignment.assignment.doctor.name}` :
                'Patient registered successfully. Doctor assignment pending.'
        });
    } catch (error) {
        console.error('Patient registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during patient registration'
        });
    }
});

// @desc    Get all patients (Staff only)
// @route   GET /api/patients
// @access  Private/Staff
router.get('/', protect, async (req, res) => {
    try {
        const { page = 1, limit = 10, search, status } = req.query;

        // Build query
        const query = {};
        if (search) {
            query.$or = [
                { firstName: { $regex: search, $options: 'i' } },
                { lastName: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        if (status) {
            query.status = status;
        }

        const patients = await Patient.find(query)
            .populate('userId', 'firstName lastName email')
            .sort({ createdAt: -1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Patient.countDocuments(query);

        res.json({
            success: true,
            data: patients,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalPatients: total,
                hasNextPage: page * limit < total,
                hasPrevPage: page > 1
            }
        });
    } catch (error) {
        console.error('Get patients error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get patient by ID
// @route   GET /api/patients/:id
// @access  Private/Staff
router.get('/:id', protect, async (req, res) => {
    try {
        const patient = await Patient.findById(req.params.id)
            .populate('userId', 'firstName lastName email');

        if (!patient) {
            return res.status(404).json({
                success: false,
                message: 'Patient not found'
            });
        }

        res.json({
            success: true,
            data: patient
        });
    } catch (error) {
        console.error('Get patient error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Update patient
// @route   PUT /api/patients/:id
// @access  Private/Staff
router.put('/:id', protect, requireStaff, [
    body('firstName').optional().trim().isLength({ min: 2, max: 50 }),
    body('lastName').optional().trim().isLength({ min: 2, max: 50 }),
    body('phone').optional().matches(/^[\+]?[1-9][\d]{0,15}$/),
    body('email').optional().isEmail().normalizeEmail(),
    body('currentSymptoms').optional().trim().isLength({ min: 10, max: 1000 }),
    body('medicalHistory').optional().trim().isLength({ max: 2000 })
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

        const patient = await Patient.findById(req.params.id);
        if (!patient) {
            return res.status(404).json({
                success: false,
                message: 'Patient not found'
            });
        }

        // Update fields
        const updateFields = [
            'firstName', 'lastName', 'phone', 'email', 'address',
            'emergencyContact', 'bloodType', 'allergies', 'currentSymptoms',
            'medicalHistory', 'currentMedications', 'insurance', 'status'
        ];

        updateFields.forEach(field => {
            if (req.body[field] !== undefined) {
                patient[field] = req.body[field];
            }
        });

        // If symptoms or medical history changed, regenerate QR code
        if (req.body.currentSymptoms || req.body.medicalHistory) {
            patient.generateQRCode();
        }

        const updatedPatient = await patient.save();

        res.json({
            success: true,
            data: updatedPatient
        });
    } catch (error) {
        console.error('Update patient error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Generate new QR code for patient
// @route   POST /api/patients/:id/qr-code
// @access  Private/Staff
router.post('/:id/qr-code', protect, async (req, res) => {
    try {
        const patient = await Patient.findById(req.params.id);
        if (!patient) {
            return res.status(404).json({
                success: false,
                message: 'Patient not found'
            });
        }

        // Generate new QR code
        const qrCode = patient.generateQRCode();
        await patient.save();

        res.json({
            success: true,
            data: {
                qrCode: qrCode.code,
                expiresAt: qrCode.expiresAt
            }
        });
    } catch (error) {
        console.error('Generate QR code error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get patient by QR code
// @route   POST /api/patients/qr-scan
// @access  Private/Staff
router.post('/qr-scan', protect, [
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
            // find patient by qr code
            const patient = await Patient.findOne({ 'qrCode.code': qrCode }).populate('userId', 'firstName lastName email');
            if (!patient) {
                return res.status(404).json({
                    success: false,
                    message: 'Patient not found'
                });
            }

            // Check if QR code is still active
            if (!patient.qrCode.isActive || patient.isQRCodeExpired()) {
                return res.status(400).json({
                    success: false,
                    message: 'QR code is no longer active or expired'
                });
            }

            res.json({
                success: true,
                data: patient
            });
        } catch (parseError) {
            return res.status(400).json({
                success: false,
                message: 'Invalid QR code format'
            });
        }
    } catch (error) {
        console.error('QR scan error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get patient statistics
// @route   GET /api/patients/stats/overview
// @access  Private/Staff
router.get('/stats/overview', protect, requireStaff, async (req, res) => {
    try {
        const totalPatients = await Patient.countDocuments();
        const activePatients = await Patient.countDocuments({ status: 'active' });
        const todayRegistrations = await Patient.countDocuments({
            createdAt: {
                $gte: new Date().setHours(0, 0, 0, 0)
            }
        });

        // Get patients by age groups
        const ageGroups = await Patient.aggregate([
            {
                $addFields: {
                    age: {
                        $floor: {
                            $divide: [
                                { $subtract: [new Date(), '$dateOfBirth'] },
                                365 * 24 * 60 * 60 * 1000
                            ]
                        }
                    }
                }
            },
            {
                $group: {
                    _id: {
                        $cond: {
                            if: { $lt: ['$age', 18] },
                            then: '0-17',
                            else: {
                                $cond: {
                                    if: { $lt: ['$age', 30] },
                                    then: '18-29',
                                    else: {
                                        $cond: {
                                            if: { $lt: ['$age', 50] },
                                            then: '30-49',
                                            else: {
                                                $cond: {
                                                    if: { $lt: ['$age', 65] },
                                                    then: '50-64',
                                                    else: '65+'
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.json({
            success: true,
            data: {
                totalPatients,
                activePatients,
                todayRegistrations,
                ageGroups
            }
        });
    } catch (error) {
        console.error('Get patient stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

export default router;
