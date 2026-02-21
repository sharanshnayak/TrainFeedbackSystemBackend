const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  feedbackNo: {
    type: Number,
    required: true
  },
  trainNo: {
    type: String,
    required: [true, 'Please provide train number']
  },
  trainName: {
    type: String,
    default: ''
  },
  coachNo: {
    type: String,
    required: [true, 'Please provide coach number']
  },
  pnr: {
    type: String,
    required: [true, 'Please provide PNR'],
    match: [/^\d+$/, 'PNR must contain only numbers']
  },
  mobile: {
    type: String,
    required: [true, 'Please provide mobile number'],
    match: [/^\d{10}$/, 'Please provide a valid 10-digit mobile number']
  },
  ns1: {
    type: Number,
    default: 0
  },
  ns2: {
    type: Number,
    default: 0
  },
  ns3: {
    type: Number,
    default: 0
  },
  psi: {
    type: Number,
    required: [true, 'Please provide PSI value']
  },
  reportDate: {
    type: Date,
    required: [true, 'Please provide report date']
  },
  feedbackText: {
    type: String,
    maxlength: [500, 'Feedback text cannot exceed 500 characters'],
    default: ''
  },
  feedbackRating: {
    type: String,
    enum: ['', 'poor', 'average', 'good', 'very good', 'excellent'],
    default: ''
  },
  submittedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  submittedByUserId: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update updatedAt on save
feedbackSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Create compound index for faster queries
feedbackSchema.index({ trainNo: 1, reportDate: 1 });
feedbackSchema.index({ reportDate: 1 });

module.exports = mongoose.model('Feedback', feedbackSchema);


