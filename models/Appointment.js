import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema({
    // Patient reference
    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: true
    },

    // Doctor reference
    doctorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // Appointment details
    appointmentDate: {
        type: Date,
        required: true
    },
    startTime: {
        type: String,
        required: true,
        match: [/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Please enter a valid time in HH:MM format']
    },
    endTime: {
        type: String,
        required: true,
        match: [/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Please enter a valid time in HH:MM format']
    },

    // Appointment type and status
    type: {
        type: String,
        enum: ['consultation', 'follow-up', 'emergency', 'routine-checkup', 'specialist'],
        default: 'consultation'
    },
    status: {
        type: String,
        enum: ['scheduled', 'confirmed', 'in-progress', 'completed', 'cancelled', 'no-show'],
        default: 'scheduled'
    },

    // Reason for visit
    reason: {
        type: String,
        required: true,
        maxlength: [500, 'Reason cannot exceed 500 characters']
    },

    // Symptoms (copied from patient for quick access)
    symptoms: {
        type: String,
        maxlength: [1000, 'Symptoms cannot exceed 1000 characters']
    },

    // Notes and comments
    notes: {
        type: String,
        maxlength: [1000, 'Notes cannot exceed 1000 characters']
    },

    // Priority level
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'emergency'],
        default: 'medium'
    },

    // Reminder settings
    reminders: {
        sms: {
            type: Boolean,
            default: true
        },
        email: {
            type: Boolean,
            default: true
        },
        reminderTime: {
            type: Number, // hours before appointment
            default: 24
        }
    },

    // Actual times (filled when appointment starts/completes)
    actualStartTime: Date,
    actualEndTime: Date,

    // Created by
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    // Cancellation information
    cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    cancellationReason: String,
    cancelledAt: Date
}, {
    timestamps: true
});

// Indexes for better query performance
appointmentSchema.index({ appointmentDate: 1, startTime: 1 });
appointmentSchema.index({ doctorId: 1, appointmentDate: 1 });
appointmentSchema.index({ patientId: 1 });
appointmentSchema.index({ status: 1 });
appointmentSchema.index({ type: 1 });

// Virtual for appointment date and time
appointmentSchema.virtual('appointmentDateTime').get(function () {
    if (!this.appointmentDate || !this.startTime) return null;

    const date = new Date(this.appointmentDate);
    const [hours, minutes] = this.startTime.split(':');
    date.setHours(parseInt(hours), parseInt(minutes), 0, 0);

    return date;
});

// Virtual for duration
appointmentSchema.virtual('duration').get(function () {
    if (!this.startTime || !this.endTime) return null;

    const start = new Date(`2000-01-01T${this.startTime}:00`);
    const end = new Date(`2000-01-01T${this.endTime}:00`);
    const diffMs = end - start;

    return Math.floor(diffMs / (1000 * 60)); // Duration in minutes
});

// Virtual for is today
appointmentSchema.virtual('isToday').get(function () {
    if (!this.appointmentDate) return false;

    const today = new Date();
    const appointmentDate = new Date(this.appointmentDate);

    return today.toDateString() === appointmentDate.toDateString();
});

// Virtual for is overdue
appointmentSchema.virtual('isOverdue').get(function () {
    if (!this.appointmentDateTime || this.status === 'completed') return false;

    return new Date() > this.appointmentDateTime;
});

// Pre-save middleware to validate time conflicts
appointmentSchema.pre('save', async function (next) {
    if (this.isNew || this.isModified('appointmentDate') || this.isModified('startTime') || this.isModified('doctorId')) {
        try {
            // Check for time conflicts with other appointments for the same doctor
            const conflictingAppointment = await this.constructor.findOne({
                doctorId: this.doctorId,
                appointmentDate: this.appointmentDate,
                status: { $in: ['scheduled', 'confirmed'] },
                _id: { $ne: this._id }
            });

            if (conflictingAppointment) {
                const error = new Error('Time slot conflict with existing appointment');
                error.name = 'ValidationError';
                return next(error);
            }

            next();
        } catch (error) {
            next(error);
        }
    } else {
        next();
    }
});

// Static method to get appointments for a specific date
appointmentSchema.statics.getAppointmentsByDate = function (date, doctorId = null) {
    const query = { appointmentDate: date };
    if (doctorId) query.doctorId = doctorId;

    return this.find(query)
        .populate('patientId', 'firstName lastName phone')
        .populate('doctorId', 'firstName lastName')
        .sort({ startTime: 1 });
};

// Static method to get today's appointments
appointmentSchema.statics.getTodayAppointments = function (doctorId = null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const query = { appointmentDate: today };
    if (doctorId) query.doctorId = doctorId;

    return this.find(query)
        .populate('patientId', 'firstName lastName phone symptoms')
        .populate('doctorId', 'firstName lastName')
        .sort({ startTime: 1 });
};

// Static method to get upcoming appointments
appointmentSchema.statics.getUpcomingAppointments = function (patientId, limit = 10) {
    return this.find({
        patientId,
        appointmentDate: { $gte: new Date() },
        status: { $in: ['scheduled', 'confirmed'] }
    })
        .populate('doctorId', 'firstName lastName department')
        .sort({ appointmentDate: 1, startTime: 1 })
        .limit(limit);
};

// Method to confirm appointment
appointmentSchema.methods.confirm = function () {
    this.status = 'confirmed';
    return this.save();
};

// Method to start appointment
appointmentSchema.methods.start = function () {
    this.status = 'in-progress';
    this.actualStartTime = new Date();
    return this.save();
};

// Method to complete appointment
appointmentSchema.methods.complete = function () {
    this.status = 'completed';
    this.actualEndTime = new Date();
    return this.save();
};

// Method to cancel appointment
appointmentSchema.methods.cancel = function (cancelledBy, reason) {
    this.status = 'cancelled';
    this.cancelledBy = cancelledBy;
    this.cancellationReason = reason;
    this.cancelledAt = new Date();
    return this.save();
};

// Ensure virtual fields are serialized
appointmentSchema.set('toJSON', {
    virtuals: true,
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});

const Appointment = mongoose.model('Appointment', appointmentSchema);

export default Appointment;
