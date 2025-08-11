import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
    // Basic user information
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
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters'],
        select: false // Don't include password in queries by default
    },

    // Role-based access control
    role: {
        type: String,
        enum: ['patient', 'reception', 'doctor', 'admin'],
        default: 'patient',
        required: true
    },

    // Additional user details
    phone: {
        type: String,
        trim: true,
        match: [/^[\+]?[1-9][\d]{0,15}$/, 'Please enter a valid phone number']
    },
    dateOfBirth: {
        type: Date
    },

    // For doctors and reception staff
    employeeId: {
        type: String,
        unique: true,
        sparse: true // Allows multiple null values
    },
    department: {
        type: String,
        trim: true
    },
    specializations: [{
        type: String,
        trim: true
    }],
    
    // Doctor-specific fields
    licenseNumber: {
        type: String,
        trim: true
    },
    yearsOfExperience: {
        type: Number,
        min: 0
    },

    // Account status
    isActive: {
        type: Boolean,
        default: true
    },
    isVerified: {
        type: Boolean,
        default: false
    },

    // Timestamps
    lastLogin: {
        type: Date
    }
}, {
    timestamps: true // Adds createdAt and updatedAt fields
});

// Index for better query performance
userSchema.index({ email: 1 });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });

// Virtual for full name
userSchema.virtual('fullName').get(function () {
    return `${this.firstName} ${this.lastName}`;
});

// Pre-save middleware to hash password
userSchema.pre('save', async function (next) {
    // Only hash the password if it has been modified (or is new)
    if (!this.isModified('password')) return next();

    try {
        // Hash password with cost of 12
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Instance method to check password
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Static method to find user by email
userSchema.statics.findByEmail = function (email) {
    return this.findOne({ email: email.toLowerCase() });
};

// Method to get public profile (without sensitive data)
userSchema.methods.getPublicProfile = function () {
    const userObject = this.toObject();
    delete userObject.password;
    delete userObject.__v;
    return userObject;
};

// Ensure virtual fields are serialized
userSchema.set('toJSON', {
    virtuals: true,
    transform: function (doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
    }
});

const User = mongoose.model('User', userSchema);

export default User;
