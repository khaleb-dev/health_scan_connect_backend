/**
 * Intelligent Doctor Assignment Service
 * 
 * This service handles the core functionality of:
 * 1. Accepting patient input (QR code with patient ID and symptoms)
 * 2. Matching symptoms to medical specializations
 * 3. Finding available doctors with required specialization
 * 4. Prioritizing doctors based on workload, queue, and urgency
 * 5. Assigning the best doctor and updating system logs
 */

import User from '../models/User.js';
import Queue from '../models/Queue.js';
import Appointment from '../models/Appointment.js';
import Patient from '../models/Patient.js';

// Comprehensive symptom-to-specialization knowledge base
const SYMPTOM_SPECIALIZATION_MAP = {
  // Cardiology
  'chest pain': ['cardiology', 'emergency'],
  'heart palpitations': ['cardiology'],
  'shortness of breath': ['cardiology', 'pulmonology'],
  'irregular heartbeat': ['cardiology'],
  'chest tightness': ['cardiology', 'emergency'],
  'heart attack': ['emergency', 'cardiology'],
  'high blood pressure': ['cardiology', 'internal-medicine'],
  'coronary': ['cardiology'],
  
  // Dermatology
  'skin rash': ['dermatology'],
  'acne': ['dermatology'],
  'eczema': ['dermatology'],
  'psoriasis': ['dermatology'],
  'moles': ['dermatology'],
  'skin cancer': ['dermatology', 'oncology'],
  'dermatitis': ['dermatology'],
  'hives': ['dermatology', 'allergy'],
  
  // Orthopedics
  'bone pain': ['orthopedics'],
  'joint pain': ['orthopedics', 'rheumatology'],
  'back pain': ['orthopedics', 'neurology'],
  'fracture': ['orthopedics', 'emergency'],
  'arthritis': ['rheumatology', 'orthopedics'],
  'knee pain': ['orthopedics'],
  'shoulder pain': ['orthopedics'],
  'hip pain': ['orthopedics'],
  'muscle pain': ['orthopedics', 'sports-medicine'],
  
  // Neurology
  'headache': ['neurology', 'internal-medicine'],
  'migraine': ['neurology'],
  'seizure': ['neurology', 'emergency'],
  'dizziness': ['neurology', 'ent'],
  'memory loss': ['neurology', 'psychiatry'],
  'stroke': ['emergency', 'neurology'],
  'tremor': ['neurology'],
  'numbness': ['neurology'],
  
  // Gastroenterology
  'stomach pain': ['gastroenterology', 'internal-medicine'],
  'nausea': ['gastroenterology', 'internal-medicine'],
  'vomiting': ['gastroenterology', 'emergency'],
  'diarrhea': ['gastroenterology', 'infectious-disease'],
  'constipation': ['gastroenterology', 'internal-medicine'],
  'heartburn': ['gastroenterology'],
  'acid reflux': ['gastroenterology'],
  'bloating': ['gastroenterology'],
  
  // Pulmonology
  'cough': ['pulmonology', 'internal-medicine'],
  'asthma': ['pulmonology', 'allergy'],
  'bronchitis': ['pulmonology'],
  'pneumonia': ['pulmonology', 'emergency'],
  'lung pain': ['pulmonology'],
  'breathing difficulty': ['pulmonology', 'emergency'],
  
  // ENT (Ear, Nose, Throat)
  'ear pain': ['ent'],
  'hearing loss': ['ent'],
  'sore throat': ['ent', 'internal-medicine'],
  'tonsillitis': ['ent'],
  'sinusitis': ['ent'],
  'nasal congestion': ['ent', 'allergy'],
  'voice hoarseness': ['ent'],
  
  // Ophthalmology
  'eye pain': ['ophthalmology'],
  'vision problems': ['ophthalmology'],
  'blurred vision': ['ophthalmology', 'neurology'],
  'eye infection': ['ophthalmology'],
  'glaucoma': ['ophthalmology'],
  'cataracts': ['ophthalmology'],
  
  // Psychiatry
  'depression': ['psychiatry'],
  'anxiety': ['psychiatry'],
  'panic attacks': ['psychiatry', 'cardiology'],
  'insomnia': ['psychiatry', 'neurology'],
  'mood swings': ['psychiatry'],
  'bipolar': ['psychiatry'],
  
  // Emergency
  'severe pain': ['emergency'],
  'unconscious': ['emergency'],
  'bleeding': ['emergency', 'surgery'],
  'poisoning': ['emergency'],
  'overdose': ['emergency'],
  'trauma': ['emergency', 'surgery'],
  'burns': ['emergency', 'plastic-surgery'],
  
  // General/Internal Medicine
  'fever': ['internal-medicine', 'infectious-disease'],
  'fatigue': ['internal-medicine'],
  'weight loss': ['internal-medicine', 'oncology'],
  'weight gain': ['internal-medicine', 'endocrinology'],
  'diabetes': ['endocrinology', 'internal-medicine'],
  'hypertension': ['cardiology', 'internal-medicine'],
  'infection': ['infectious-disease', 'internal-medicine'],
  
  // Gynecology
  'menstrual problems': ['gynecology'],
  'pregnancy': ['obstetrics', 'gynecology'],
  'pelvic pain': ['gynecology'],
  'breast pain': ['gynecology', 'oncology'],
  
  // Urology
  'urinary problems': ['urology'],
  'kidney stones': ['urology', 'emergency'],
  'prostate': ['urology'],
  'bladder': ['urology']
};

// Priority levels for symptoms
const SYMPTOM_PRIORITY = {
  'emergency': ['heart attack', 'stroke', 'seizure', 'unconscious', 'severe bleeding', 'poisoning', 'overdose', 'trauma', 'severe pain', 'breathing difficulty', 'chest pain'],
  'high': ['fracture', 'pneumonia', 'severe infection', 'high fever', 'vomiting blood', 'severe burns'],
  'medium': ['fever', 'infection', 'persistent pain', 'chronic conditions'],
  'low': ['routine checkup', 'minor symptoms', 'follow-up']
};

/**
 * Analyzes symptoms and returns matching medical specializations
 * @param {string} symptoms - Patient's reported symptoms
 * @returns {Object} - Analysis result with specializations and priority
 */
export const analyzeSymptoms = (symptoms) => {
  const symptomsLower = symptoms.toLowerCase();
  const matchedSpecializations = new Set();
  let priority = 'low';
  const matchedSymptoms = [];

  // Check for exact symptom matches
  Object.keys(SYMPTOM_SPECIALIZATION_MAP).forEach(symptom => {
    if (symptomsLower.includes(symptom)) {
      matchedSymptoms.push(symptom);
      SYMPTOM_SPECIALIZATION_MAP[symptom].forEach(spec => {
        matchedSpecializations.add(spec);
      });
    }
  });

  // Determine priority level
  for (const [priorityLevel, keywords] of Object.entries(SYMPTOM_PRIORITY)) {
    for (const keyword of keywords) {
      if (symptomsLower.includes(keyword)) {
        priority = priorityLevel;
        break;
      }
    }
    if (priority !== 'low') break;
  }

  // If no specific matches, default to internal medicine
  if (matchedSpecializations.size === 0) {
    matchedSpecializations.add('internal-medicine');
  }

  return {
    specializations: Array.from(matchedSpecializations),
    priority,
    matchedSymptoms,
    confidence: matchedSymptoms.length > 0 ? 'high' : 'low'
  };
};

/**
 * Calculates doctor workload score (lower is better)
 * @param {string} doctorId - Doctor's ID
 * @returns {Promise<number>} - Workload score
 */
export const calculateDoctorWorkload = async (doctorId) => {
  try {
    // Get current queue count
    const queueCount = await Queue.countDocuments({
      doctorId,
      status: { $in: ['waiting', 'in-progress'] }
    });

    // Get today's appointments
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAppointments = await Appointment.countDocuments({
      doctorId,
      appointmentDate: {
        $gte: today,
        $lt: tomorrow
      },
      status: { $in: ['scheduled', 'confirmed', 'in-progress'] }
    });

    // Calculate workload score (queue has higher weight)
    const workloadScore = (queueCount * 2) + todayAppointments;
    
    return workloadScore;
  } catch (error) {
    console.error('Error calculating doctor workload:', error);
    return 999; // High score for error cases
  }
};

/**
 * Gets average wait time for a doctor's queue
 * @param {string} doctorId - Doctor's ID
 * @returns {Promise<number>} - Average wait time in minutes
 */
export const getAverageWaitTime = async (doctorId) => {
  try {
    const queueEntries = await Queue.find({
      doctorId,
      status: 'waiting'
    }).sort({ queueNumber: 1 });

    if (queueEntries.length === 0) return 0;

    // Estimate 15 minutes per patient ahead in queue
    return queueEntries.length * 15;
  } catch (error) {
    console.error('Error calculating wait time:', error);
    return 999; // High wait time for error cases
  }
};

/**
 * Finds the best available doctor for given specializations and priority
 * @param {Array} specializations - Required medical specializations
 * @param {string} priority - Urgency level
 * @returns {Promise<Object>} - Best doctor assignment result
 */
export const findBestDoctor = async (specializations, priority = 'medium') => {
  try {
    // Find doctors with matching specializations
    const availableDoctors = await User.find({
      role: 'doctor',
      isActive: true,
      $or: [
        { department: { $in: specializations } },
        { specializations: { $in: specializations } },
        // Fallback to general practitioners
        { department: 'internal-medicine' }
      ]
    });

    if (availableDoctors.length === 0) {
      throw new Error('No available doctors found for the required specializations');
    }

    // Score each doctor
    const doctorScores = await Promise.all(
      availableDoctors.map(async (doctor) => {
        const workload = await calculateDoctorWorkload(doctor._id);
        const waitTime = await getAverageWaitTime(doctor._id);
        
        // Calculate specialization match score
        let specializationScore = 0;
        if (doctor.department && specializations.includes(doctor.department)) {
          specializationScore += 10;
        }
        if (doctor.specializations) {
          specializationScore += doctor.specializations.filter(spec => 
            specializations.includes(spec)
          ).length * 5;
        }

        // Emergency priority gets immediate assignment to any available doctor
        const priorityMultiplier = priority === 'emergency' ? 0.1 : 
                                 priority === 'high' ? 0.5 :
                                 priority === 'medium' ? 1 : 1.5;

        // Final score (lower is better)
        const finalScore = (workload + (waitTime / 15)) * priorityMultiplier - specializationScore;

        return {
          doctor,
          workload,
          waitTime,
          specializationScore,
          finalScore
        };
      })
    );

    // Sort by final score (ascending - lower is better)
    doctorScores.sort((a, b) => a.finalScore - b.finalScore);

    const bestMatch = doctorScores[0];

    return {
      doctor: bestMatch.doctor,
      workload: bestMatch.workload,
      estimatedWaitTime: bestMatch.waitTime,
      specializationMatch: bestMatch.specializationScore > 0,
      confidence: bestMatch.specializationScore > 5 ? 'high' : 'medium',
      reason: `Best match based on specialization (${bestMatch.doctor.department}), current workload (${bestMatch.workload} patients), and estimated wait time (${bestMatch.waitTime} minutes)`
    };
  } catch (error) {
    console.error('Error finding best doctor:', error);
    throw error;
  }
};

/**
 * Main function: Assigns doctor based on patient symptoms
 * @param {string} patientId - Patient's ID
 * @param {string} symptoms - Patient's reported symptoms
 * @returns {Promise<Object>} - Assignment result with doctor and system logs
 */
export const assignDoctorToPatient = async (patientId, symptoms) => {
  try {
    // Step 1: Analyze symptoms
    const symptomAnalysis = analyzeSymptoms(symptoms);
    
    // Step 2: Find best doctor
    const doctorAssignment = await findBestDoctor(
      symptomAnalysis.specializations, 
      symptomAnalysis.priority
    );

    console.log('Symptom Analysis:', JSON.stringify(symptomAnalysis, null, 2));
    console.log('Best Doctor Found:', JSON.stringify(doctorAssignment, null, 2));

    // Step 3: Create queue entry
    const queueEntry = new Queue({
      patientId,
      assignedDoctor: doctorAssignment.doctor._id,
      priority: symptomAnalysis.priority,
      symptoms,
      queueNumber: 1, // this will be generated and updated in pre-save hook regardless
    });

    await queueEntry.save();

    // Step 4: Update system logs
    const logEntry = {
      timestamp: new Date(),
      patientId,
      doctorId: doctorAssignment.doctor._id,
      action: 'doctor_assigned',
      symptomAnalysis,
      doctorAssignment: {
        doctorName: `${doctorAssignment.doctor.firstName} ${doctorAssignment.doctor.lastName}`,
        department: doctorAssignment.doctor.department,
        workload: doctorAssignment.workload,
        waitTime: doctorAssignment.estimatedWaitTime
      },
      queueNumber: queueEntry.queueNumber
    };

    console.log('Doctor Assignment Log:', JSON.stringify(logEntry, null, 2));

    return {
      success: true,
      assignment: {
        doctor: {
          id: doctorAssignment.doctor._id,
          name: `Dr. ${doctorAssignment.doctor.firstName} ${doctorAssignment.doctor.lastName}`,
          department: doctorAssignment.doctor.department,
          specializations: doctorAssignment.doctor.specializations || []
        },
        queue: {
          queueNumber: queueEntry.queueNumber,
          estimatedWaitTime: doctorAssignment.estimatedWaitTime,
          priority: symptomAnalysis.priority
        },
        analysis: symptomAnalysis
      },
      logs: logEntry
    };

  } catch (error) {
    console.error('Error in doctor assignment:', error);
    
    // Log the error
    const errorLog = {
      timestamp: new Date(),
      patientId,
      action: 'assignment_failed',
      error: error.message,
      symptoms
    };
    
    console.error('Assignment Error Log:', JSON.stringify(errorLog, null, 2));
    
    throw new Error(`Doctor assignment failed: ${error.message}`);
  }
};

/**
 * Gets assignment statistics for dashboard
 * @returns {Promise<Object>} - Assignment statistics
 */
export const getAssignmentStats = async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [
      totalAssignments,
      emergencyAssignments,
      avgWaitTime,
      specialtyDistribution
    ] = await Promise.all([
      Queue.countDocuments({
        createdAt: { $gte: today }
      }),
      Queue.countDocuments({
        priority: 'emergency',
        createdAt: { $gte: today }
      }),
      Queue.aggregate([
        { $match: { createdAt: { $gte: today } } },
        { $group: { _id: null, avgWait: { $avg: '$waitTime' } } }
      ]),
      Queue.aggregate([
        { $match: { createdAt: { $gte: today } } },
        { $lookup: { from: 'users', localField: 'doctorId', foreignField: '_id', as: 'doctor' } },
        { $unwind: '$doctor' },
        { $group: { _id: '$doctor.department', count: { $sum: 1 } } }
      ])
    ]);

    return {
      totalAssignments,
      emergencyAssignments,
      averageWaitTime: avgWaitTime[0]?.avgWait || 0,
      specialtyDistribution: specialtyDistribution.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {})
    };
  } catch (error) {
    console.error('Error getting assignment stats:', error);
    return {
      totalAssignments: 0,
      emergencyAssignments: 0,
      averageWaitTime: 0,
      specialtyDistribution: {}
    };
  }
};

export default {
  analyzeSymptoms,
  findBestDoctor,
  assignDoctorToPatient,
  calculateDoctorWorkload,
  getAverageWaitTime,
  getAssignmentStats
};


