import mongoose from 'mongoose';

const patientSchema = new mongoose.Schema({
    // Reference to user account (if patient has registered account)
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false // Optional - patients can register without account
    },

    // Basic patient information
    firstName: {
        type: String,
        required: [true, 'First name is required'],
        trim: true,
        maxlength: [50, 'First name cannot exceed 50 characters']
    },
    lastName: {
        type: String,
        required: [true, 'Last name is required'],
        trim: true,
        maxlength: [50, 'Last name cannot exceed 50 characters']
    },
    dateOfBirth: {
        type: Date,
        required: [true, 'Date of birth is required']
    },
    gender: {
        type: String,
        enum: ['male', 'female', 'other', 'prefer-not-to-say'],
        required: [true, 'Gender is required']
    },

    // Contact information
    phone: {
        type: String,
        required: [true, 'Phone number is required'],
        trim: true,
        match: [/^[\+]?[1-9][\d]{0,15}$/, 'Please enter a valid phone number']
    },
    email: {
        type: String,
        lowercase: true,
        trim: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    address: {
        street: String,
        city: String,
        state: String,
        zipCode: String,
        country: {
            type: String,
            default: 'USA'
        }
    },

    // Emergency contact
    emergencyContact: {
        name: String,
        relationship: String,
        phone: String
    },

    // Medical information
    bloodType: {
        type: String,
        enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'unknown'],
        default: 'unknown'
    },
    allergies: [{
        name: String,
        severity: {
            type: String,
            enum: ['mild', 'moderate', 'severe'],
            default: 'mild'
        },
        notes: String
    }],

    // Current visit information
    currentSymptoms: {
        type: String,
        required: [true, 'Current symptoms are required'],
        maxlength: [1000, 'Symptoms description cannot exceed 1000 characters']
    },
    medicalHistory: {
        type: String,
        maxlength: [2000, 'Medical history cannot exceed 2000 characters']
    },
    currentMedications: [{
        name: String,
        dosage: String,
        frequency: String,
        startDate: Date
    }],

    // Insurance information
    insurance: {
        provider: String,
        policyNumber: String,
        groupNumber: String,
        expiryDate: Date
    },

    // Patient status
    status: {
        type: String,
        enum: ['active', 'inactive', 'deceased'],
        default: 'active'
    },

    // QR Code information
    qrCode: {
        code: String, // The actual QR code data
        imageUrl: String, // URL to the generated QR code image
        expiresAt: {
            type: Date,
            required: true
        },
        isActive: {
            type: Boolean,
            default: true
        },
        scanCount: {
            type: Number,
            default: 0
        },
        lastScanned: Date
    },

    // Doctor assignment information
    assignedDoctor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    // Visit tracking
    lastVisit: Date,
    totalVisits: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Indexes for better query performance
patientSchema.index({ firstName: 1, lastName: 1 });
patientSchema.index({ phone: 1 });
patientSchema.index({ email: 1 });
patientSchema.index({ 'qrCode.isActive': 1 });
patientSchema.index({ status: 1 });

// Virtual for full name
patientSchema.virtual('fullName').get(function () {
    return `${this.firstName} ${this.lastName}`;
});

// Virtual for age
patientSchema.virtual('age').get(function () {
    if (!this.dateOfBirth) return null;
    const today = new Date();
    const birthDate = new Date(this.dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }

    return age;
});

// Method to check if QR code is expired
patientSchema.methods.isQRCodeExpired = function () {
    if (!this.qrCode || !this.qrCode.expiresAt) return true;
    return new Date() > this.qrCode.expiresAt;
};

// Method to generate new QR code
patientSchema.methods.generateQRCode = function () {
    const patientId = this._id.toString();
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + parseInt(process.env.QR_CODE_EXPIRE_DAYS) || 7);

    this.qrCode = {
        // code: JSON.stringify({
        //     patientId,
        //     firstName: this.firstName,
        //     lastName: this.lastName,
        //     dateOfBirth: this.dateOfBirth,
        //     phone: this.phone,
        //     email: this.email,
        //     currentSymptoms: this.currentSymptoms,
        //     medicalHistory: this.medicalHistory,
        //     expiryDate: expiryDate.toISOString(),
        //     createdAt: new Date().toISOString()
        // }),
        code: `${patientId}-${expiryDate.getTime()}`,
        expiresAt: expiryDate.toISOString(),
        createdAt: new Date().toISOString(),
        isActive: true
    };

    return this.qrCode;
};

// Static method to find active patients
patientSchema.statics.findActive = function () {
    return this.find({ status: 'active' });
};

// Static method to find patients by name
patientSchema.statics.findByName = function (firstName, lastName) {
    return this.find({
        firstName: { $regex: firstName, $options: 'i' },
        lastName: { $regex: lastName, $options: 'i' }
    });
};

// Ensure virtual fields are serialized
patientSchema.set('toJSON', {
    virtuals: true,
    transform: function (doc, ret) {
        delete ret.__v;
        return ret;
    }
});

const Patient = mongoose.model('Patient', patientSchema);

export default Patient;
