import mongoose from 'mongoose';

const queueSchema = new mongoose.Schema({
    // Patient reference
    patientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Patient',
        required: true
    },

    // Queue information
    queueNumber: {
        type: Number,
        required: true,
        unique: true
    },

    // Check-in information
    checkedInBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    checkedInAt: {
        type: Date,
        default: Date.now
    },

    // Queue status
    status: {
        type: String,
        enum: ['waiting', 'in-progress', 'completed', 'cancelled', 'no-show'],
        default: 'waiting'
    },

    // Priority and severity
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'emergency'],
        default: 'medium'
    },
    severity: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium'
    },

    // Estimated wait time (in minutes)
    estimatedWaitTime: {
        type: Number,
        default: 15
    },

    // Actual times
    calledAt: Date,
    startedAt: Date,
    completedAt: Date,

    // Doctor assignment
    assignedDoctor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    // Notes and comments
    notes: {
        type: String,
        maxlength: [500, 'Notes cannot exceed 500 characters']
    },

    // Visit type
    visitType: {
        type: String,
        enum: ['walk-in', 'appointment', 'emergency', 'follow-up'],
        default: 'walk-in'
    },

    // Symptoms (copied from patient for quick access)
    symptoms: {
        type: String,
        required: true
    }
}, {
    timestamps: true
});

// Indexes for better query performance
queueSchema.index({ status: 1, priority: 1 });
queueSchema.index({ checkedInAt: 1 });
queueSchema.index({ patientId: 1 });
queueSchema.index({ assignedDoctor: 1 });
queueSchema.index({ queueNumber: 1 });

// Virtual for wait time
queueSchema.virtual('waitTime').get(function () {
    if (!this.checkedInAt) return 0;
    const now = new Date();
    const diffMs = now - this.checkedInAt;
    return Math.floor(diffMs / (1000 * 60)); // Convert to minutes
});

// Virtual for formatted wait time
queueSchema.virtual('formattedWaitTime').get(function () {
    const minutes = this.waitTime;
    if (minutes < 60) {
        return `${minutes} min`;
    } else {
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    }
});

// Pre-save middleware to generate queue number
queueSchema.pre('save', async function (next) {
    if (this.isNew) {
        try {
            // Get the highest queue number for today
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const lastQueue = await this.constructor.findOne({
                checkedInAt: { $gte: today }
            }).sort({ queueNumber: -1 });

            this.queueNumber = lastQueue ? lastQueue.queueNumber + 1 : 1;
            next();
        } catch (error) {
            next(error);
        }
    } else {
        next();
    }
});

// Static method to get current queue
queueSchema.statics.getCurrentQueue = function () {
    return this.find({
        status: { $in: ['waiting', 'in-progress'] }
    })
        .populate('patientId', 'firstName lastName phone currentSymptoms')
        .populate('assignedDoctor', 'firstName lastName')
        .sort({ priority: -1, checkedInAt: 1 });
};

// Static method to get queue statistics
queueSchema.statics.getQueueStats = async function () {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = await this.aggregate([
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

    return stats;
};

// Method to mark as called
queueSchema.methods.markAsCalled = function () {
    this.status = 'in-progress';
    this.calledAt = new Date();
    return this.save();
};

// Method to mark as started
queueSchema.methods.markAsStarted = function () {
    this.startedAt = new Date();
    return this.save();
};

// Method to mark as completed
queueSchema.methods.markAsCompleted = function () {
    this.status = 'completed';
    this.completedAt = new Date();
    return this.save();
};

// Method to cancel
queueSchema.methods.cancel = function (reason) {
    this.status = 'cancelled';
    this.notes = reason || 'Cancelled by user';
    return this.save();
};

// Ensure virtual fields are serialized
queueSchema.set('toJSON', {
    virtuals: true,
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});

const Queue = mongoose.model('Queue', queueSchema);

export default Queue;
