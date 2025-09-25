import express from 'express';
import { body, validationResult } from 'express-validator';
import Queue from '../models/Queue.js';
import Patient from '../models/Patient.js';
import { protect, requireStaff } from '../middleware/auth.js';
import { assignDoctorToPatient } from '../services/doctorAssignment.js';

const router = express.Router();

// @desc    Add patient to queue (check-in)
// @route   POST /api/queue/check-in
// @access  Private/Staff
router.post('/check-in', protect, requireStaff, [
    body('patientId').isMongoId().withMessage('Valid patient ID is required'),
    body('priority').optional().isIn(['low', 'medium', 'high', 'emergency']),
    body('severity').optional().isIn(['low', 'medium', 'high']),
    body('visitType').optional().isIn(['walk-in', 'appointment', 'emergency', 'follow-up']),
    body('notes').optional().trim().isLength({ max: 500 })
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

        const { patientId, priority, severity, visitType, notes, estimatedWaitTime } = req.body;

        // Check if patient exists
        const patient = await Patient.findById(patientId);
        if (!patient) {
            return res.status(404).json({
                success: false,
                message: 'Patient not found'
            });
        }

        // Check if patient is already in queue
        const existingQueue = await Queue.findOne({
            patientId,
            status: { $in: ['waiting', 'in-progress'] }
        });

        if (existingQueue) {
            return res.status(400).json({
                success: false,
                message: 'Patient is already in queue',
                data: existingQueue
            });
        }

        let assignment = null;
        try {
            assignment = await assignDoctorToPatient(patient._id, patient.currentSymptoms);

            // Update patient with assigned doctor
            patient.assignedDoctor = assignment.assignment.doctor.id;
            await patient.save();
        } catch (assignmentError) {
            console.error('Doctor assignment failed: ', assignmentError);
            // Continue without assignment - staff can manually assign later
        }

        // Create/Update queue entry
        let queueEntry;
        
        if (assignment?.assignment?.queue?.queueNumber) {
            queueEntry = await Queue.findOneAndUpdate({ patientId, queueNumber: assignment.assignment.queue.queueNumber }, {
                severity: severity || 'medium',
                visitType: visitType || 'walk-in',
                notes,
                checkedInBy: req.user._id,
            });
        } else {
            queueEntry = new Queue({
                patientId,
                checkedInBy: req.user._id,
                priority: priority || 'medium',
                severity: severity || 'medium',
                visitType: visitType || 'walk-in',
                notes,
                estimatedWaitTime: estimatedWaitTime || 15,
                symptoms: patient.currentSymptoms,
                queueNumber: new Date().getTime(),
                assignedDoctor: patient.assignedDoctor || null
            });

            await queueEntry.save();
        }

        // Populate patient details
        await queueEntry.populate('patientId', 'firstName lastName phone currentSymptoms');
        await queueEntry.populate('checkedInBy', 'firstName lastName');
        await queueEntry.populate('assignedDoctor', 'firstName lastName phone role department specializations yearsOfExperience');

        res.status(201).json({
            success: true,
            message: 'Patient checked in successfully',
            data: queueEntry
        });
    } catch (error) {
        console.error('Check-in error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during check-in'
        });
    }
});

// @desc    Get current queue
// @route   GET /api/queue
// @access  Private/Staff
router.get('/', protect, requireStaff, async (req, res) => {
    try {
        const { status, doctorId } = req.query;

        // Build query
        const query = {};
        if (status) {
            query.status = status;
        } else {
            // Default to active queue items
            query.status = { $in: ['waiting', 'in-progress'] };
        }

        if (doctorId) {
            query.assignedDoctor = doctorId;
        }

        const queue = await Queue.find(query)
            .populate('patientId', 'firstName lastName phone currentSymptoms age')
            .populate('checkedInBy', 'firstName lastName')
            .populate('assignedDoctor', 'firstName lastName')
            .sort({ priority: -1, checkedInAt: 1 });

        res.json({
            success: true,
            count: queue.length,
            data: queue
        });
    } catch (error) {
        console.error('Get queue error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get queue entry by ID
// @route   GET /api/queue/:id
// @access  Private/Staff
router.get('/:id', protect, requireStaff, async (req, res) => {
    try {
        const queueEntry = await Queue.findById(req.params.id)
            .populate('patientId')
            .populate('checkedInBy', 'firstName lastName')
            .populate('assignedDoctor', 'firstName lastName');

        if (!queueEntry) {
            return res.status(404).json({
                success: false,
                message: 'Queue entry not found'
            });
        }

        res.json({
            success: true,
            data: queueEntry
        });
    } catch (error) {
        console.error('Get queue entry error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Update queue entry status
// @route   PUT /api/queue/:id/status
// @access  Private/Staff
router.put('/:id/status', protect, requireStaff, [
    body('status').isIn(['waiting', 'in-progress', 'completed', 'cancelled', 'no-show']).withMessage('Invalid status'),
    body('notes').optional().trim().isLength({ max: 500 })
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

        const queueEntry = await Queue.findById(req.params.id);
        if (!queueEntry) {
            return res.status(404).json({
                success: false,
                message: 'Queue entry not found'
            });
        }

        // Update status and handle specific actions
        queueEntry.status = status;
        if (notes) queueEntry.notes = notes;

        switch (status) {
            case 'in-progress':
                queueEntry.calledAt = new Date();
                break;
            case 'completed':
                queueEntry.completedAt = new Date();
                break;
            case 'cancelled':
                queueEntry.notes = notes || 'Cancelled by staff';
                break;
        }

        await queueEntry.save();

        // Populate for response
        await queueEntry.populate('patientId', 'firstName lastName phone currentSymptoms');
        await queueEntry.populate('assignedDoctor', 'firstName lastName');

        res.json({
            success: true,
            message: `Queue entry ${status}`,
            data: queueEntry
        });
    } catch (error) {
        console.error('Update queue status error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Assign doctor to queue entry
// @route   PUT /api/queue/:id/assign-doctor
// @access  Private/Staff
router.put('/:id/assign-doctor', protect, requireStaff, [
    body('doctorId').isMongoId().withMessage('Valid doctor ID is required')
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

        const { doctorId } = req.body;

        const queueEntry = await Queue.findById(req.params.id);
        if (!queueEntry) {
            return res.status(404).json({
                success: false,
                message: 'Queue entry not found'
            });
        }

        queueEntry.assignedDoctor = doctorId;
        await queueEntry.save();

        // Populate for response
        await queueEntry.populate('patientId', 'firstName lastName phone currentSymptoms');
        await queueEntry.populate('assignedDoctor', 'firstName lastName');

        res.json({
            success: true,
            message: 'Doctor assigned successfully',
            data: queueEntry
        });
    } catch (error) {
        console.error('Assign doctor error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Call next patient
// @route   POST /api/queue/call-next
// @access  Private/Staff
router.post('/call-next', protect, requireStaff, async (req, res) => {
    try {
        const { doctorId } = req.body;

        let currentQuery = { status: 'in-progress' };
        if (doctorId) {
            currentQuery.assignedDoctor = doctorId;
        }

        // Find the next patient in queue
        let nextQuery = { status: 'waiting' };
        if (doctorId) {
            nextQuery.assignedDoctor = doctorId;
        }

        const currentPatient = await Queue.findOne(currentQuery)
            .populate('patientId', 'firstName lastName phone currentSymptoms')
            .populate('assignedDoctor', 'firstName lastName')
            .sort({ priority: -1, checkedInAt: 1 });

        if (currentPatient) {
            // Mark current patient as completed
            currentPatient.status = 'completed';
            currentPatient.completedAt = new Date();
            await currentPatient.save();
        }
        
        const nextPatient = await Queue.findOne(nextQuery)
            .populate('patientId', 'firstName lastName phone currentSymptoms')
            .populate('assignedDoctor', 'firstName lastName')
            .sort({ priority: -1, checkedInAt: 1 });

        if (!nextPatient) {
            return res.status(404).json({
                success: false,
                message: 'No patients waiting in queue'
            });
        }

        // Mark as called
        nextPatient.status = 'in-progress';
        nextPatient.calledAt = new Date();
        await nextPatient.save();

        res.json({
            success: true,
            message: 'Next patient called',
            data: nextPatient
        });
    } catch (error) {
        console.error('Call next patient error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Get queue statistics
// @route   GET /api/queue/stats
// @access  Private/Staff
router.get('/stats/overview', protect, requireStaff, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Get today's queue statistics
        const todayStats = await Queue.aggregate([
            {
                $match: {
                    checkedInAt: { $gte: today }
                }
            },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    avgWaitTime: { $avg: '$waitTime' }
                }
            }
        ]);

        // Get current queue counts
        const waitingCount = await Queue.countDocuments({ status: 'waiting' });
        const inProgressCount = await Queue.countDocuments({ status: 'in-progress' });
        const completedToday = await Queue.countDocuments({
            status: 'completed',
            completedAt: { $gte: today }
        });

        // Get average wait time
        const avgWaitTime = await Queue.aggregate([
            {
                $match: {
                    status: 'completed',
                    completedAt: { $gte: today }
                }
            },
            {
                $group: {
                    _id: null,
                    avgWaitTime: { $avg: '$waitTime' }
                }
            }
        ]);

        res.json({
            success: true,
            data: {
                currentQueue: {
                    waiting: waitingCount,
                    inProgress: inProgressCount
                },
                todayStats: todayStats,
                completedToday,
                avgWaitTime: avgWaitTime[0]?.avgWaitTime || 0
            }
        });
    } catch (error) {
        console.error('Get queue stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

// @desc    Remove patient from queue
// @route   DELETE /api/queue/:id
// @access  Private/Staff
router.delete('/:id', protect, requireStaff, async (req, res) => {
    try {
        const queueEntry = await Queue.findById(req.params.id);
        if (!queueEntry) {
            return res.status(404).json({
                success: false,
                message: 'Queue entry not found'
            });
        }

        // Only allow deletion of waiting or cancelled entries
        if (!['waiting', 'cancelled'].includes(queueEntry.status)) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete queue entry that is in progress or completed'
            });
        }

        await Queue.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'Queue entry removed successfully'
        });
    } catch (error) {
        console.error('Remove queue entry error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error'
        });
    }
});

export default router;
