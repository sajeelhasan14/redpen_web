// The full calculus sequence RedPen covers, grouped by the course it usually sits in.
// It is spread into COPY.coverage, so tests/copy.test.ts polices it like the rest of the copy.
// Placement varies between universities; the course labels are the common US split.

export const SYLLABUS = [
  {
    course: 'Calculus I',
    units: [
      {
        name: 'Limits and continuity',
        note: 'The foundation of differential calculus',
        topics: ['Functions and their graphs', 'Domain and range', 'Piecewise-defined functions', 'Average rate of change', 'The intuitive meaning of a limit', 'Left-hand and right-hand limits', 'Limits at a point', 'Limits at infinity', 'Infinite limits and vertical asymptotes', 'Limit laws and algebraic evaluation', 'Factoring and rationalizing to evaluate limits', 'Trigonometric limits', 'The squeeze theorem', 'Continuity at a point', 'Continuity over an interval', 'Removable, jump and infinite discontinuities', 'Intermediate Value Theorem'],
      },
      {
        name: 'Derivatives and differentiation',
        note: 'Every rule, from first principles up',
        topics: ['Derivative as an instantaneous rate of change', 'Derivative as the slope of a tangent line', 'The limit definition of the derivative', 'Differentiability and continuity', 'Power, constant multiple, sum and difference rules', 'Product rule', 'Quotient rule', 'Chain rule', 'Exponential and logarithmic functions', 'Trigonometric functions', 'Inverse trigonometric functions', 'Implicit differentiation', 'Logarithmic differentiation', 'Higher-order derivatives', 'Second derivative and acceleration', 'Derivatives of inverse functions', 'Tangent and normal lines', 'Parametrically defined curves'],
      },
      {
        name: 'Applications of derivatives',
        note: 'Where most midterm points are won and lost',
        topics: ['Increasing and decreasing functions', 'Critical points', 'Local maxima and minima', 'Absolute extrema on a closed interval', 'First derivative test', 'Second derivative test', 'Concavity and points of inflection', 'Curve sketching', 'Optimization', 'Related rates', 'Linear approximation', 'Differentials and error estimation', "Newton's method", "Rolle's theorem", 'Mean Value Theorem', "L'Hôpital's rule"],
      },
      {
        name: 'Integration',
        note: 'Antiderivatives to the Fundamental Theorem',
        topics: ['Antiderivatives and indefinite integrals', 'Basic integration formulas', 'Exponential, logarithmic and trigonometric integrals', 'Initial-value problems', 'Riemann sums', 'Left, right and midpoint approximations', 'Definite integrals and their properties', 'The Fundamental Theorem of Calculus, Parts I and II', 'Accumulation functions', 'Net change', 'Average value of a function', "Trapezoidal and Simpson's rules", 'u-substitution'],
      },
    ],
  },
  {
    course: 'Calculus II',
    units: [
      {
        name: 'Techniques of integration',
        note: 'The toolbox every Calc II exam tests',
        topics: ['Integration by parts', 'Trigonometric integrals and identities', 'Trigonometric substitution', 'Partial fractions', 'Rational functions', 'Improper integrals with infinite limits', 'Improper integrals with infinite discontinuities', 'Convergence and divergence of improper integrals'],
      },
      {
        name: 'Applications of integration',
        note: 'Areas, volumes and physics',
        topics: ['Area under and between curves', 'Volumes by cross-sections', 'Disk and washer methods', 'Cylindrical shells', 'Arc length', 'Surface area of revolution', 'Work', 'Fluid pressure and force', 'Mass, moments and center of mass', 'Probability density functions'],
      },
      {
        name: 'Sequences and series',
        note: 'Every convergence test, then Taylor series',
        topics: ['Sequences and their limits', 'Monotone and bounded sequences', 'Partial sums', 'Geometric and telescoping series', 'Divergence test', 'Integral test', 'Direct and limit comparison tests', 'Alternating series test', 'Absolute and conditional convergence', 'Ratio and root tests', 'Power series', 'Radius and interval of convergence', 'Taylor and Maclaurin series', 'Remainder and approximation error', 'Functions as power series'],
      },
      {
        name: 'Parametric and polar',
        note: 'Curves described a different way',
        topics: ['Parametric curves', 'Eliminating the parameter', 'First and second derivatives of parametric curves', 'Parametric arc length', 'Polar coordinates', 'Converting between polar and Cartesian', 'Graphing polar curves', 'Derivatives in polar form', 'Areas enclosed by polar curves'],
      },
    ],
  },
  {
    course: 'Multivariable and Vector Calculus',
    units: [
      {
        name: 'Vectors and 3D geometry',
        note: 'The language of Calc III',
        topics: ['Vectors in 2D and 3D', 'Dot product and angles', 'Cross product', 'Lines and planes in space', 'Distances between points, lines and planes', 'Determinants', 'Vector-valued curves', 'Velocity and acceleration along a curve'],
      },
      {
        name: 'Partial derivatives',
        note: 'Functions of several variables',
        topics: ['Functions of two and three variables', 'Level curves and level surfaces', 'Limits and continuity in several variables', 'Partial and mixed partial derivatives', 'Tangent planes', 'Linear approximation and total differentials', 'The multivariable chain rule', 'Implicit differentiation in several variables', 'Gradients and directional derivatives', 'Direction of fastest increase'],
      },
      {
        name: 'Multivariable optimization',
        note: 'Critical points, saddles and constraints',
        topics: ['Critical points', 'Second derivative test in two variables', 'Saddle points', 'Extrema on a closed region', 'Lagrange multipliers', 'Several constraints'],
      },
      {
        name: 'Multiple integrals',
        note: 'Double and triple integrals',
        topics: ['Double integrals over rectangles and general regions', 'Changing the order of integration', 'Polar double integrals', 'Triple integrals', 'Cylindrical and spherical coordinates', 'Jacobians and change of variables', 'Areas, volumes and mass'],
      },
      {
        name: 'Vector calculus',
        note: 'The big theorems',
        topics: ['Vector fields', 'Conservative fields and potential functions', 'Line integrals', 'Work and path independence', 'Flux across a curve', "Green's theorem", 'Parametrized surfaces', 'Surface integrals and flux', 'Divergence and curl', 'Divergence theorem', "Stokes' theorem"],
      },
    ],
  },
  {
    course: 'Intro Differential Equations',
    units: [
      {
        name: 'First differential equations',
        note: 'Often the last unit of a calculus course',
        topics: ['What a differential equation is', 'Order', 'Initial-value problems', 'Exponential growth and decay', 'Separable equations: separating the variables', 'Population models', "Newton's law of cooling"],
      },
    ],
  },
] as const;
