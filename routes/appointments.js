import express from 'express';
import { body, validationResult } from 'express-validator';
import Appointment from '../models/Appointment.js';
import Patient from '../models/Patient.js';
import User from '../models/User.js';
import { protect, requireStaff } from '../middleware/auth.js';

const router = express.Router();

// @desc    Create new appointment
// @route   POST /api/appointments
// @access  Private/Staff
router.post('/', protect, requireStaff, [
    body('patientId').isMongoId().withMessage('Valid patient ID is required'),
    body('doctorId').isMongoId().withMessage('Valid doctor ID is required'),
    body('appointmentDate').isISO8601().withMessage('Valid appointment date is required'),
    body('startTime').matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid start time is required (HH:MM)'),
    body('endTime').matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid end time is required (HH:MM)'),
    body('reason').trim().isLength({ min: 10, max: 500 }).withMessage('Reason must be between 10 and 500 characters'),
    body('type').optional().isIn(['consultation', 'follow-up', 'emergency', 'routine-checkup', 'specialist']),
    body('priority').optional().isIn(['low', 'medium', 'high', 'emergency'])
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
            patientId,
            doctorId,
            appointmentDate,
            startTime,
            endTime,
            reason,
            type,
            priority,
            symptoms,
            notes
        } = req.body;

        // Check if patient exists
        const patient = await Patient.findById(patientId);
        if (!patient) {
            return res.status(404).json({
                success: false,
                message: 'Patient not found'
            });
        }

        // Check if doctor exists and is a doctor
        const doctor = await User.findById(doctorId);
        if (!doctor || doctor.role !== 'doctor') {
            return res.status(404).json({
                success: false,
                message: 'Doctor not found'
            });
        }

        // Create appointment
        const appointment = new Appointment({
            patientId,
            doctorId,
            appointmentDate,
            startTime,
            endTime,
            reason,
            type: type || 'consultation',
            priority: priority || 'medium',
            symptoms: symptoms || patient.currentSymptoms,
            notes,
            createdBy: req.user._id
        });

        await appointment.save();

        // Populate for response
        await appointment.populate('patientId', 'firstName lastName phone');
        await appointment.populate('doctorId', 'firstName lastName department');

        res.status(201).json({
            success: true,
            message: 'Appointment created successfully',
            data: appointment
        });
    } catch (error) {
        console.error('Create appointment error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error creating appointment'
        });
    }
});

// @desc    Get all appointments
// @route   GET /api/appointments
// @access  Private/Staff
router.get('/', protect, requireStaff, async (req, res) => {
    try {
        const {
            page = 1,
            limit = 10,
            date,
            doctorId,
            patientId,
            status,
            type
        } = req.query;

        // Build query
        const query = {};
        if (date) {
            const searchDate = new Date(date);
            searchDate.setHours(0, 0, 0, 0);
            const nextDay = new Date(searchDate);
            nextDay.setDate(nextDay.getDate() + 1);
            query.appointmentDate = { $gte: searchDate, $lt: nextDay };
        }
        if (doctorId) query.doctorId = doctorId;
        if (patientId) query.patientId = patientId;
        if (status) query.status = status;
        if (type) query.type = type;

        const appointments = await Appointment.find(query)
            .populate('patientId', 'firstName lastName phone')
            .populate('doctorId', 'firstName lastName department')
            .populate('createdBy', 'firstName lastName')
            .sort({ appointmentDate: 1, startTime: 1 })
            .limit(limit * 1)
            .skip((page - 1) * limit);

        const total = await Appointment.countDocuments(query);

        res.json({
            success: true,
            data: appointments,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / limit),
                totalAppointments: total,
                hasNextPage: page * limit < total,
                hasPrevPage: page > 1
            }
        });
    } catch (error) {
        console.error('Get appointments error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get today's appointments
// @route   GET /api/appointments/today
// @access  Private/Staff
router.get('/today', protect, requireStaff, async (req, res) => {
    try {
        const { doctorId } = req.query;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const query = { appointmentDate: today };
        if (doctorId) query.doctorId = doctorId;

        const appointments = await Appointment.find(query)
            .populate('patientId', 'firstName lastName phone symptoms')
            .populate('doctorId', 'firstName lastName department')
            .sort({ startTime: 1 });

        res.json({
            success: true,
            count: appointments.length,
            data: appointments
        });
    } catch (error) {
        console.error('Get today appointments error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get upcoming appointments
// @route   GET /api/appointments/upcoming
// @access  Private/Staff
router.get('/upcoming', protect, requireStaff, async (req, res) => {
    try {
        const { patientId, doctorId, limit = 10 } = req.query;
        const now = new Date();

        const query = {
            appointmentDate: { $gte: now },
            status: { $in: ['scheduled', 'confirmed'] }
        };

        if (patientId) query.patientId = patientId;
        if (doctorId) query.doctorId = doctorId;

        const appointments = await Appointment.find(query)
            .populate('patientId', 'firstName lastName phone')
            .populate('doctorId', 'firstName lastName department')
            .sort({ appointmentDate: 1, startTime: 1 })
            .limit(parseInt(limit));

        res.json({
            success: true,
            count: appointments.length,
            data: appointments
        });
    } catch (error) {
        console.error('Get upcoming appointments error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get appointment by ID
// @route   GET /api/appointments/:id
// @access  Private/Staff
router.get('/:id', protect, requireStaff, async (req, res) => {
    try {
        const appointment = await Appointment.findById(req.params.id)
            .populate('patientId')
            .populate('doctorId', 'firstName lastName department')
            .populate('createdBy', 'firstName lastName');

        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: 'Appointment not found'
            });
        }

        res.json({
            success: true,
            data: appointment
        });
    } catch (error) {
        console.error('Get appointment error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Update appointment
// @route   PUT /api/appointments/:id
// @access  Private/Staff
router.put('/:id', protect, requireStaff, [
    body('appointmentDate').optional().isISO8601(),
    body('startTime').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
    body('endTime').optional().matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/),
    body('reason').optional().trim().isLength({ min: 10, max: 500 }),
    body('notes').optional().trim().isLength({ max: 1000 })
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

        const appointment = await Appointment.findById(req.params.id);
        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: 'Appointment not found'
            });
        }

        // Only allow updates if appointment is not completed
        if (appointment.status === 'completed') {
            return res.status(400).json({
                success: false,
                message: 'Cannot update completed appointment'
            });
        }

        // Update fields
        const updateFields = [
            'appointmentDate', 'startTime', 'endTime', 'reason',
            'symptoms', 'notes', 'priority', 'type'
        ];

        updateFields.forEach(field => {
            if (req.body[field] !== undefined) {
                appointment[field] = req.body[field];
            }
        });

        await appointment.save();

        // Populate for response
        await appointment.populate('patientId', 'firstName lastName phone');
        await appointment.populate('doctorId', 'firstName lastName department');

        res.json({
            success: true,
            message: 'Appointment updated successfully',
            data: appointment
        });
    } catch (error) {
        console.error('Update appointment error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Update appointment status
// @route   PUT /api/appointments/:id/status
// @access  Private/Staff
router.put('/:id/status', protect, requireStaff, [
    body('status').isIn(['scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled', 'no-show']).withMessage('Invalid status'),
    body('notes').optional().trim().isLength({ max: 1000 })
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

        const { status, notes } = req.body;

        const appointment = await Appointment.findById(req.params.id);
        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: 'Appointment not found'
            });
        }

        // Update status and handle specific actions
        appointment.status = status;
        if (notes) appointment.notes = notes;

        switch (status) {
            case 'in-progress':
                appointment.actualStartTime = new Date();
                break;
            case 'completed':
                appointment.actualEndTime = new Date();
                break;
            case 'cancelled':
                appointment.cancelledBy = req.user._id;
                appointment.cancelledAt = new Date();
                appointment.cancellationReason = notes || 'Cancelled by staff';
                break;
        }

        await appointment.save();

        // Populate for response
        await appointment.populate('patientId', 'firstName lastName phone');
        await appointment.populate('doctorId', 'firstName lastName department');

        res.json({
            success: true,
            message: `Appointment ${status}`,
            data: appointment
        });
    } catch (error) {
        console.error('Update appointment status error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get appointment statistics
// @route   GET /api/appointments/stats
// @access  Private/Staff
router.get('/stats/overview', protect, requireStaff, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Get today's appointment statistics
        const todayStats = await Appointment.aggregate([
            {
                $match: {
                    appointmentDate: today
                }
            },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);

        // Get upcoming appointments count
        const upcomingCount = await Appointment.countDocuments({
            appointmentDate: { $gte: today },
            status: { $in: ['scheduled', 'confirmed'] }
        });

        // Get overdue appointments
        const overdueCount = await Appointment.countDocuments({
            appointmentDate: { $lt: today },
            status: { $in: ['scheduled', 'confirmed'] }
        });

        // Get appointments by type
        const typeStats = await Appointment.aggregate([
            {
                $match: {
                    appointmentDate: { $gte: today }
                }
            },
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 }
                }
            }
        ]);

        res.json({
            success: true,
            data: {
                todayStats,
                upcomingCount,
                overdueCount,
                typeStats
            }
        });
    } catch (error) {
        console.error('Get appointment stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Cancel appointment
// @route   DELETE /api/appointments/:id
// @access  Private/Staff
router.delete('/:id', protect, requireStaff, [
    body('reason').optional().trim().isLength({ max: 500 })
], async (req, res) => {
    try {
        const { reason } = req.body;

        const appointment = await Appointment.findById(req.params.id);
        if (!appointment) {
            return res.status(404).json({
                success: false,
                message: 'Appointment not found'
            });
        }

        // Only allow cancellation if appointment is not completed
        if (appointment.status === 'completed') {
            return res.status(400).json({
                success: false,
                message: 'Cannot cancel completed appointment'
            });
        }

        // Cancel appointment
        appointment.status = 'cancelled';
        appointment.cancelledBy = req.user._id;
        appointment.cancelledAt = new Date();
        appointment.cancellationReason = reason || 'Cancelled by staff';

        await appointment.save();

        res.json({
            success: true,
            message: 'Appointment cancelled successfully'
        });
    } catch (error) {
        console.error('Cancel appointment error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

export default router;
